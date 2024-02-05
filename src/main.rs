#[macro_use]
extern crate rocket;

use rocket::form::Form;
use rocket::fs::FileServer;
use rocket::http::{ContentType, Status};
use rocket::response::stream::{Event, EventStream};
use rocket::serde::json;
use rocket::serde::{Deserialize, Serialize};
use rocket::tokio::select;
use rocket::tokio::sync::broadcast::{channel, error::RecvError, Sender};
use rocket::{Shutdown, State};
use std::collections::BTreeMap;
use std::collections::HashMap;
use std::mem::drop;
use std::sync::RwLock;

static NOT_ALLOWED_UNAMES: [&str; 4] = ["[system]", "[debug]", "[status]", "system"];

#[derive(Debug, Clone, FromForm, Serialize, Deserialize, Eq, Hash, PartialEq)]
#[cfg_attr(test, derive(UriDisplayQuery))]
#[serde(crate = "rocket::serde")]
struct Message {
    #[field(validate = len(2..32))]
    pub room: String,
    #[field(validate = len(..32))]
    pub username: String,
    #[field(validate = len(..65536))]
    pub message: String,
    #[field(validate = len(..24))]
    pub color: String,
}

struct Users {
    pub users: RwLock<Vec<String>>,
}

struct Rooms {
    pub users: RwLock<Vec<String>>,
}

struct SavedMessages {
    pub map: RwLock<HashMap<String, Vec<Message>>>,
}

#[derive(FromForm)]
struct UserInput {
    pub old_username: String,
    pub new_username: String,
}

#[derive(FromForm)]
struct RoomName {
    pub room_name: String,
}

fn rw_lock_to_json<T: Serialize>(users: &RwLock<Vec<T>>) -> (Status, (ContentType, String)) {
    let mut status = Status::Ok;

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
            }
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

fn check_repeats(s: &str) -> usize {
    let mut delays: BTreeMap<_, std::str::Chars> = BTreeMap::new();
    for (i, c) in s.chars().enumerate() {
        delays.retain(|_, iter| iter.next() == Some(c));
        delays.insert(i + 1, s.chars());
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
fn post(
    form: Form<Message>,
    queue: &State<Sender<Message>>,
    rooms: &State<Rooms>,
    messages: &State<SavedMessages>,
) {
    // A send 'fails' if there are no active subscribers. That's okay.
    let inner = form.into_inner();
    let message = &inner.message;
    let username = &inner.username;
    let room = &inner.room;
    let mut char_comp: Vec<i32> = vec![0; 256];
    let mut homogenus_comp = false;
    let rooms = &rooms.users;
    let messages = &messages.map;

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

    loop {
        if let Ok(mut vec) = rooms.try_write() {
            if !vec.iter().any(|e| room.contains(e)) {
                vec.push(room.to_string());
            }
            break;
        }
    }

    loop {
        if let Ok(mut hashmap) = messages.try_write() {
            if !hashmap.keys().any(|e| room.contains(e)) {
                hashmap.insert(
                    room.to_string(),
                    vec![
                        Message {
                            room: room.to_string(),
                            username: String::from("System"),
                            message: format!("Welcome to {}", room),
                            color: String::from("hash"),
                        },
                        inner.clone(),
                    ],
                );
            } else {
                hashmap.get_mut(room).unwrap().push(inner.clone());
            }
            break;
        }
    }

    if !(homogenus_comp
        || check_repeats(&message.replace(' ', "")) != message.len() - message.matches(' ').count()
        || NOT_ALLOWED_UNAMES.contains(&username.to_lowercase().as_ref())
        || message.starts_with('/'))
    {
        let _ = queue.send(inner);
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

    rw_lock_to_json(users)
}

#[get("/get_rooms")]
fn get_rooms(rooms: &State<Rooms>) -> (Status, (ContentType, String)) {
    let rooms = &rooms.users;

    rw_lock_to_json(rooms)
}

#[post("/messages", data = "<room_name>")]
fn get_messages(
    messages: &State<SavedMessages>,
    room_name: Form<RoomName>,
) -> (Status, (ContentType, String)) {
    let inner = room_name.into_inner();
    let room = inner.room_name;
    let map = &messages.map;
    let mut messages = vec![];

    loop {
        if let Ok(map) = map.read() {
            if let Some(vec) = map.get(&room) {
                for i in vec {
                    messages.push(i.clone());
                }
                break;
            } else {
                return (Status::NotFound, (ContentType::JSON, String::new()));
            }
        }
    }

    rw_lock_to_json(&RwLock::new(messages))
}

#[launch]
fn rocket() -> _ {
    rocket::build()
        .manage(channel::<Message>(1024).0)
        .manage(Users {
            users: RwLock::new(vec![]),
        })
        .manage(Rooms {
            users: RwLock::new(vec!["lobby".to_string()]),
        })
        .manage(SavedMessages {
            map: RwLock::new(HashMap::new()),
        })
        .mount(
            "/",
            routes![post, events, add_user, get_users, get_rooms, get_messages],
        )
        .mount("/", FileServer::from("static"))
}
