#[macro_use]
extern crate rocket;

use rocket::form::Form;
use rocket::fs::{relative, FileServer};
use rocket::response::stream::{Event, EventStream};
use rocket::serde::{Deserialize, Serialize};
use rocket::tokio::select;
use rocket::http::{ContentType, Status};
use rocket::tokio::sync::broadcast::{channel, error::RecvError, Sender};
use rocket::{Shutdown, State};
use rocket::serde::json;
use std::collections::BTreeMap;
use std::sync::RwLock;
use std::mem::drop;

#[derive(Debug, Clone, FromForm, Serialize, Deserialize)]
#[cfg_attr(test, derive(PartialEq, UriDisplayQuery))]
#[serde(crate = "rocket::serde")]
struct Message {
    #[field(validate = len(..32))]
    pub room: String,
    #[field(validate = len(..32))]
    pub username: String,
    #[field(validate = len(..65536))]
    pub message: String,
}

struct Users {
    pub users: RwLock<Vec<String>>
}

#[derive(FromForm)]
struct UserInput {
    pub old_username: String,
    pub new_username: String
}


fn check_repeats(s:&str)->usize {
    let mut delays: BTreeMap<_, std::str::Chars> = BTreeMap::new();
    for (i,c) in s.chars().enumerate() {
        delays.retain(|_,iter| iter.next() == Some(c));
        delays.insert(i+1, s.chars());
    }
    delays.into_keys().next().unwrap()
}

/// Returns an infinite stream of server-sent events. Each event is a message
/// pulled from a broadcast queue sent by the `post` handler.
#[get("/events")]
async fn events(queue: &State<Sender<Message>>, mut end: Shutdown) -> EventStream![] {
    let mut rx = queue.subscribe();
    EventStream! {
        loop {
            let msg = select! {
                msg = rx.recv() => match msg {
                    Ok(msg) => msg,
                    Err(RecvError::Closed) => break,
                    Err(RecvError::Lagged(_)) => continue,
                },
                _ = &mut end => break,
            };

            yield Event::json(&msg);
        }
    }
}

/// Receive a message from a form submission and broadcast it to any receivers.
#[post("/message", data = "<form>")]
fn post(form: Form<Message>, queue: &State<Sender<Message>>) {
    // A send 'fails' if there are no active subscribers. That's okay.
    let inner = form.into_inner();
    let message = &inner.message;
    let username = &inner.username;
    let mut char_comp: Vec<i32> = vec![0; 256];
    let mut homogenus_comp = false;

    for i in message.chars() {
        char_comp[i as u8 as usize] += 1;
    }

    if message.len() > 50 {
      for i in char_comp.iter() {
          if *i > (message.len() as f32 * 0.25) as i32 {
              homogenus_comp = true;
          }
      }
    }

    if !(homogenus_comp || check_repeats(&message.replace(' ', "")) != message.len()-message.matches(' ').count() || username == "[STATUS]" || username == "[SERVER]") {
        let _res = queue.send(inner);
    }
}

#[post("/user", data = "<user_input>")]
fn add_user(total_users: &State<Users>, user_input: Form<UserInput>) {
    let inner = user_input.into_inner();
    let old_username = inner.old_username;
    let new_username = inner.new_username;
    let users = &total_users.users;

    if old_username == new_username {
      return;
    }
  
    loop {
      if let Ok(mut vec) = users.try_write() {
          if vec.iter().any(|e| old_username.contains(e)) {
              match vec.iter().position(|r| r == &old_username) {
                Some(index) => vec.remove(index),
                None => return,
              };
              vec.push(new_username);
          } else {
              vec.push(new_username);
          }
        break;
      } else {
        continue;
      }
    }
}

#[get("/get_users")]
fn get_users(total_users: &State<Users>) -> (Status, (ContentType, String)) {
    let users = &total_users.users;
    let mut status = Status::Accepted;

    let json_;

    loop {
      match users.read() {
        Ok(dat) => {
          let mut data = vec![];

          for i in dat.iter() {
            data.push(i);
          }

          json_ = json::to_string(&data);

          drop(dat);
          break;
        },
        Err(_) => continue,
      }
    }

    let json_ = match json_ {
      Ok(dat) => dat,
      Err(_) => {
        status = Status::Locked;
        String::new()
      }
    };

    (status, (ContentType::JSON, json_))
}


#[launch]
fn rocket() -> _ {
    rocket::build()
        .manage(channel::<Message>(1024).0)
        .manage(Users {users: RwLock::new(vec![])})
        .mount("/", routes![post, events, add_user, get_users])
        .mount("/", FileServer::from(relative!("static")))
}
