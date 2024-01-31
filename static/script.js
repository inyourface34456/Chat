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
let muted = [];

var STATE = {
	room: "lobby",
	rooms: {},
	connected: false,
};

// Generate a color from a "hash" of a string. Thanks, internet.
function hashColor(str) {
	let hash = 0;
	str.split('')
		.forEach(char => {
			hash = char.charCodeAt(0) + ((hash << 5) - hash);
		});
	let colour = '#';
	for(let i = 0; i < 3; i++) {
		const value = (hash >> (i * 8)) & 0xff;
		colour += value.toString(16)
			.padStart(2, '0');
	}
	return colour;
}

// Add a new room `name` and change to it. Returns `true` if the room didn't
// already exist and false otherwise.
function addRoom(name) {
	if(STATE[name]) {
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
	if(STATE.room == name) return;

	var newRoom = roomListDiv.querySelector(`.room[data-name='${name}']`);
	var oldRoom = roomListDiv.querySelector(`.room[data-name='${STATE.room}']`);
	if(!newRoom || !oldRoom) return;

	STATE.room = name;
	oldRoom.classList.remove("active");
	newRoom.classList.add("active");

	messagesDiv.querySelectorAll(".message")
		.forEach((msg) => {
			messagesDiv.removeChild(msg);
		});

	STATE[name].forEach((data) => addMessage(name, data.username, data.message));
}

// Add `message` from `username` to `room`. If `push`, then actually store the
// message. If the current room is `room`, render the message.
function addMessage(room, username, message, push = false) {
	if(push) {
		STATE[room].push({
			username,
			message
		});
	}

if(STATE.room == room && !muted.includes(username)) {
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
			const msg = JSON.parse(ev.data);
			if(!"message" in msg || !"room" in msg || !"username" in msg) return;
			addMessage(msg.room, msg.username, msg.message, true);
		});

		events.addEventListener("open", () => {
			setConnectedStatus(true);
			addMessage(STATE.room, "[STATUS]", "connected to event stream");
			retryTime = 1;
		});

		events.addEventListener("error", () => {
			setConnectedStatus(false);
			events.close();

			let timeout = retryTime;
			retryTime = Math.min(64, retryTime * 2);
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
		if(!message || !username) return;

		fetch("/user", {
				method: "POST",
				body: new URLSearchParams({
					old_username,
					new_username
				}),
			})
			.then((response) => {
				if(response.ok) {
					if(debug) {
						addMessage(STATE.room, "[STATUS]", `old_username: ${old_username}, new_username: ${new_username}`);
					}
					old_username = username;
					if(debug) {
						addMessage(STATE.room, "[STATUS]", `registered username ${username}`);
					}
				} else {
					addMessage(STATE.room, "[STATUS]", `failed to register username ${username}`);
				}
			});


			if (message.startsWith("/remove")) {
				let args = message.split(' ');
				let node = document.getElementsByClassName('id');
		
				for(let i = 0; i < node.length; i++) {
					if(node[i].textContent == args[1]) {
						node[i].parentNode.remove();
					}
				}
				messageField.value = "";
			} else if(message.startsWith("/debug")) {
				if(debug) {
					debug = false;
				} else {
					debug = true;
				}
				messageField.value = "";
			} else if(message.startsWith("/clear")) {
				const elements = document.querySelectorAll('*');
				elements.forEach((element) => {
					if(element.classList.contains('message')) {
						element.remove();
					}
				});
				messageField.value = "";
			} else if(message.startsWith("/online")) {
				fetch("/get_users", {
						method: "GET",
					})
					.then((response) => {
						if(response.ok) {
							return response.json();
						} else {
							addMessage(STATE.room, "[STATUS]", `failed to fetch users`);
							return response.json();
						}
					})
					.then((data) => {
						addMessage(STATE.room, "[STATUS]", `Users online are: ${data}`);
					});
					messageField.value = "";
			} else if(message.startsWith("/mute")) {
				let args = message.split(' ');
		
				muted.push(args[1]);
				messageField.value = "";
			} else if (message.startsWith("/unmute")) {
				let args = message.split(' ');
		
				muted = muted.filter(function (letter) {
					return letter !== args[1];
				});
				messageField.value = "";
			} else if (message.startsWith("/help")) {
				addMessage(STATE.room, "[STATUS]", `/remove [ID] - removes the message with the id specified (find the ID by hovering over the message)`);
				addMessage(STATE.room, "[STATUS]", `/remove_range [LOWER] [UPPER] - removes the messages within the range of ids specified [UPPER, LOWER]`);
				addMessage(STATE.room, "[STATUS]", `/debug - enables debug mode`);
				addMessage(STATE.room, "[STATUS]", `/online - shows all online users`);
				addMessage(STATE.room, "[STATUS]", `/mute [USERNAME] - mutes the selected user`);
				addMessage(STATE.room, "[STATUS]", `/unmute [USERNAME] - unmutes selected user`);
				addMessage(STATE.room, "[STATUS]", `/clear - clears the screen of all messages`);
			} else if (message.startsWith("/remove_range")) {
				let args = message.split(' ');
				let node = document.getElementsByClassName('id');
		
				for(let i = args[1]; i < node.length; i++) {
					if(node[i].textContent >= args[2]) {
						node[i].parentNode.remove();
						if (debug) {
							addMessage(STATE.room, "[STATUS]", `removing a message`);
						}
					}

					if (!node[i].textContent > args[2]) {
						if (debug) {
							addMessage(STATE.room, "[STATUS]", `end of loop`);
						}
						break
					}
				}
			} else if(STATE.connected) {
			fetch("/message", {
					method: "POST",
					body: new URLSearchParams({
						room,
						username,
						message
					}),
				})
				.then((response) => {
					if(response.ok) {
						messageField.value = "";
					} else {
						addMessage(STATE.room, "[STATUS]", `failed to send message`);
					}
				});
		}
	});

	// Set up the new room handler.
	newRoomForm.addEventListener("submit", (e) => {
		e.preventDefault();

		const room = roomNameField.value;
		if(!room) return;

		roomNameField.value = "";
		if(!addRoom(room)) return;

		addMessage(room, "System", `Welcome to ${room}!`, true);
	});

	// Subscribe to server-sent events.
	subscribe("/events");
}

init();