let roomListDiv = document.getElementById('room-list');
let messagesDiv = document.getElementById('messages');
let newMessageForm = document.getElementById('new-message');
let newRoomForm = document.getElementById('new-room');
let statusDiv = document.getElementById('status');

let roomTemplate = document.getElementById('room');
let messageTemplate = document.getElementById('message');

let messageField = newMessageForm.querySelector("#message");
let usernameField = newMessageForm.querySelector("#username");
let roomNameField = newRoomForm.querySelector("#name");
let id = 0;
let old_username = "";
let debug = false;

var STATE = {
  room: "lobby",
  rooms: {},
  connected: false,
}

function hash_sha256(string) {
  const utf8 = new TextEncoder().encode(string);
  return crypto.subtle.digest('SHA-256', utf8).then((hashBuffer) => {
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray
      .map((bytes) => bytes.toString(16).padStart(2, '0'))
      .join('');
    return hashHex;
  });
}

// Generate a color from a "hash" of a string. Thanks, internet.
function hashColor(str) {
  let hash = 0;
  str.split('').forEach(char => {
    hash = char.charCodeAt(0) + ((hash << 5) - hash)
  })
  let colour = '#'
  for (let i = 0; i < 3; i++) {
    const value = (hash >> (i * 8)) & 0xff
    colour += value.toString(16).padStart(2, '0')
  }
  return colour
}

// Add a new room `name` and change to it. Returns `true` if the room didn't
// already exist and false otherwise.
function addRoom(name) {
  if (STATE[name]) {
    changeRoom(name);
    return false;
  }

  var node = roomTemplate.content.cloneNode(true);
  var room = node.querySelector(".room");
  room.addEventListener("click", () => changeRoom(name));
  room.textContent = name;
  room.dataset.name = name;
  roomListDiv.appendChild(node);

  STATE[name] = [];
  changeRoom(name);
  return true;
}

// Change the current room to `name`, restoring its messages.
function changeRoom(name) {
  if (STATE.room == name) return;

  var newRoom = roomListDiv.querySelector(`.room[data-name='${name}']`);
  var oldRoom = roomListDiv.querySelector(`.room[data-name='${STATE.room}']`);
  if (!newRoom || !oldRoom) return;

  STATE.room = name;
  oldRoom.classList.remove("active");
  newRoom.classList.add("active");

  messagesDiv.querySelectorAll(".message").forEach((msg) => {
    messagesDiv.removeChild(msg)
  });

  STATE[name].forEach((data) => addMessage(name, data.username, data.message))
}

// Add `message` from `username` to `room`. If `push`, then actually store the
// message. If the current room is `room`, render the message.
function addMessage(room, username, message, push = false) {
  if (push) {
    STATE[room].push({ username, message })
  }

  if (STATE.room == room) {
    var node = messageTemplate.content.cloneNode(true);
    node.querySelector(".message .username").textContent = `${username}:`;
    node.querySelector(".message .username").style.color = hashColor(username);
    node.querySelector(".message .text").textContent = message;
    node.querySelector(".message .id").textContent = id;
    node.querySelector(".message").title = id;
    messagesDiv.appendChild(node);
    id += 1;
  }
}

// Subscribe to the event source at `uri` with exponential backoff reconnect.
function subscribe(uri) {
  var retryTime = 1;

  function connect(uri) {
    const events = new EventSource(uri);

    events.addEventListener("message", (ev) => {
      console.log("raw data", JSON.stringify(ev.data));
      console.log("decoded data", JSON.stringify(JSON.parse(ev.data)));
      const msg = JSON.parse(ev.data);
      if (!"message" in msg || !"room" in msg || !"username" in msg) return;
      if  (msg.message.startsWith("/remove")) {
            let args = msg.message.split(' ');
            let node = document.getElementsByClassName('id');
            
            for (let i = 0; i < node.length; i++) {
              if (node[i].textContent == args[1]) {
                node[i].parentNode.remove();
              }
            } 
        } else if (msg.message.startsWith("/debug")) {
          if (debug) {
            debug = false;
          } else {
            debug = true;
          }
        } else if (msg.message.startsWith("/clear")) {
          const elements = document.querySelectorAll('*');

          elements.forEach((element) => {
            if (element.classList.contains('message')) {
              element.remove();
            }
          });
        } else if (msg.message.startsWith("/clear")) {
          let users;
          fetch("/get_users", {
            method: "GET",
          }).then((response) => {
            if (response.ok) {
                return response.json();
            } else {
              addMessage(STATE.room, "[STATUS]", `failed to fetch users`);
            };
          }).then((data) => {
            if (debug) {
              addMessage(STATE.room, "[STATUS]", `${data}`);
            }
            users = JSON.parse(json);
          });

            var node = messageTemplate.content.cloneNode(true);
            node.querySelector(".message .username").textContent = `[STATUS]:`;
            node.querySelector(".message .username").style.color = hashColor(username);
            node.querySelector(".message .text").textContent = message;
            messagesDiv.appendChild(node);
        } else {
          addMessage(msg.room, msg.username, msg.message, true);	
        } 
    });

    events.addEventListener("open", () => {
      setConnectedStatus(true);
      console.log(`connected to event stream at ${uri}`);
      addMessage(STATE.room, "[STATUS]", "connected to event stream");
      retryTime = 1;
    });

    events.addEventListener("error", () => {
      setConnectedStatus(false);
      events.close();

      let timeout = retryTime;
      retryTime = Math.min(64, retryTime * 2);
      console.log(`connection lost. attempting to reconnect in ${timeout}s`);
      addMessage(STATE.room, "[STATUS]", `connection lost. attempting to reconnect in ${timeout}s`);
      setTimeout(() => connect(uri), (() => timeout * 1000)());
    });
  }

  connect(uri);
}

// Set the connection status: `true` for connected, `false` for disconnected.
function setConnectedStatus(status) {
  STATE.connected = status;
  statusDiv.className = (status) ? "connected" : "reconnecting";
}

// Let's go! Initialize the world.
function init() {
  // Initialize some rooms.
  addRoom("lobby");
  changeRoom("lobby");
  addMessage("lobby", "System", "Welcome to the chat!", true);


  // Set up the form handler.
  newMessageForm.addEventListener("submit", (e) => {
    e.preventDefault();

    const room = STATE.room;
    const message = messageField.value;
    const username = usernameField.value || "guest";
    const new_username = usernameField.value || "guest";
    if (!message || !username) return;
  
    fetch("/user", {
      method: "POST",
      body: new URLSearchParams({ old_username, new_username }),
    }).then((response) => {
      if (response.ok) {
        if (debug) {
          addMessage(STATE.room, "[STATUS]", `old_username: ${old_username}, new_username: ${new_username}`);
        }
        old_username = username;
        if (debug) {
          addMessage(STATE.room, "[STATUS]", `registered username ${username}`);
        }
      } else {
        addMessage(STATE.room, "[STATUS]", `failed to register username ${username}`);
      };
    });

    if (STATE.connected) {
      fetch("/message", {
        method: "POST",
        body: new URLSearchParams({ room, username, message }),
      }).then((response) => {
        if (response.ok) {
          messageField.value = "";
        } else {
          addMessage(STATE.room, "[STATUS]", `failed to send message`);
        }
      });
    }
  })

  // Set up the new room handler.
  newRoomForm.addEventListener("submit", (e) => {
    e.preventDefault();

    const room = roomNameField.value;
    if (!room) return;

    roomNameField.value = "";
    if (!addRoom(room)) return;

    addMessage(room, "System", `Welcome to ${room}!`, true);
  })

  // Subscribe to server-sent events.
  subscribe("/events");
}

init();