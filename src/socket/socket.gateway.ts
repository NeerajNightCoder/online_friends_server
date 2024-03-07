import {
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
} from "@nestjs/websockets";
import { randomUUID } from "crypto";
import { Server, Socket } from "socket.io";

interface TagAndClientVacant {
  [tag: string]: {
    clientId: string;
    gender: string;
    matchWithGender: string;
  }[];
}

const femaleAvailability: { [clientId: string]: boolean } = {};
const maleAvailability: { [clientId: string]: boolean } = {};
const clientsAvailability: { [clientId: string]: boolean } = {};

// chat groups data
let chatGroups = [];

const options = {
  cors: {
    origin: ["http://localhost:3000"],
    methods: ["GET", "POST"],
    credentials: true,
  },
};

function censorMessage(message, blacklist) {
  const words = message.split(/\s+/); // Split the message into words
  const censoredMessage = words.map((word) => {
    // Check if the word is in the blacklist
    if (blacklist.includes(word.toLowerCase())) {
      // If it is, replace the word with asterisks (*) of the same length
      return "*".repeat(word.length);
    } else {
      // Otherwise, keep the word unchanged
      return word;
    }
  });
  // Join the censored words back into a string
  return censoredMessage.join(" ");
}

@WebSocketGateway(options)
export class SocketGateway implements OnGatewayConnection {
  @WebSocketServer() server: Server;

  TagAndclientVacant: TagAndClientVacant = {};
  TagAndclientTaken: { [tag: string]: string } = {};
  UserPairs: { [clientId: string]: string } = {};

  handleConnection(client: Socket) {
    console.log(`Client connected on socket gateway: ${client.id}`);
    clientsAvailability[client.id] = true;
    this.server.emit(
      "activeUsersCount",
      Object.keys(clientsAvailability).length,
    );
  }

  handleDisconnect(client: Socket) {
    console.log(`Client disconnected on socket gateway: ${client.id}`);
    delete this.TagAndclientVacant[client.id];
    delete clientsAvailability[client.id];
    delete maleAvailability[client.id];
    delete femaleAvailability[client.id];
    this.server.emit(
      "activeUsersCount",
      Object.keys(clientsAvailability).length,
    );
    const partnerClientId = this.UserPairs[client.id];
    if (!partnerClientId) return;
    console.log(partnerClientId);
    const partnerClient = this.server.sockets.sockets.get(partnerClientId);
    if (partnerClient) partnerClient.emit("userLeft", client.id);
  }

  @SubscribeMessage("createRoom")
  createRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { name: string; isLocked: boolean; password: string },
  ) {
    const { name, isLocked, password } = data;

    // Create the new room object
    const newRoom = {
      id: randomUUID(), // You need to generate a unique ID for the room
      name,
      isLocked,
      password,
      members: [client.id], // Add the client as the first member
    };

    // Emit success response to the client
    client.emit("createRoomSuccess", { room: newRoom });
    chatGroups.push(newRoom);
  }
  @SubscribeMessage("getChatRooms")
  getChatRooms(@ConnectedSocket() client: Socket) {
    // Emit the list of available chat rooms to the client
    client.emit("chatRoomsList", chatGroups);
  }

  @SubscribeMessage("joinRoom")
  joinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { roomId: string; password?: string }, // Make password optional
  ) {
    const { roomId, password } = data;

    // Find the room with the given roomId
    const room = chatGroups.find((room) => room.id === roomId);

    if (!room) {
      // Room not found, emit error to the client
      client.emit("joinRoomError", { message: "Room not found" });
      return;
    }

    if (room.isLocked && room.password !== password) {
      // Room is locked and the provided password is incorrect, emit error to the client
      client.emit("joinRoomError", { message: "Incorrect password" });
      return;
    }

    // Add the client to the room's members
    room.members.push(client.id);
    client.join(room.id);

    // Emit success response to the client
    client.emit("joinRoomSuccess", { room });
  }

  @SubscribeMessage("setTag")
  setTag(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    data: { tag: string; gender: string; matchWithGender: string },
  ) {
    console.log("###############tags", this.TagAndclientVacant);
    const { tag, gender, matchWithGender } = data;
    console.log(
      "Tag and gender of connecting user",
      tag,
      gender,
      matchWithGender,
    );
    if (gender === "male") maleAvailability[client.id] = true;
    if (gender === "female") femaleAvailability[client.id] = true;
    this.server.emit("genderCount", {
      maleUsers: Object.keys(maleAvailability).length,
      femaleUsers: Object.keys(femaleAvailability).length,
    });
    // Check if the tag already exists in TagAndclientVacant
    console.log(this.TagAndclientVacant[tag]);
    if (this.TagAndclientVacant[tag]) {
      const matchingClients = this.TagAndclientVacant[tag];
      const matchIndex = matchingClients.findIndex(
        (matchingClient) =>
          matchingClient.matchWithGender === gender &&
          matchingClient.gender === matchWithGender,
      );
      if (matchIndex === -1) {
        console.log("no client matched");
        // If there's no match, add the client to the list
        this.TagAndclientVacant[tag].push({
          clientId: client.id,
          gender,
          matchWithGender,
        });
        console.log(`Tag ${tag} set for client: ${client.id}`);
        return;
      }
      // Get the socket ID of the matched client
      const matchedClient = matchingClients.splice(matchIndex, 1)[0];
      const { clientId: matchedClientId } = matchedClient;
      // Join a room with the matched client
      const room = `${client.id} and ${matchedClientId}`;
      client.join(room);
      const matchedClientSocket =
        this.server.sockets.sockets.get(matchedClientId);
      if (matchedClientSocket) {
        matchedClientSocket.join(room);
        matchedClientSocket.emit("matched", {
          room: room,
          matchedUser: client.id,
        });
        client.emit("matched", {
          room: room,
          matchedUser: matchedClientSocket.id,
        });
      }
      this.UserPairs[matchedClientId] = client.id;
      this.UserPairs[client.id] = matchedClientId;
    } else {
      // If the tag doesn't exist, create a new array and add the client to it
      this.TagAndclientVacant[tag] = [
        {
          clientId: client.id,
          gender,
          matchWithGender,
        },
      ];
      console.log(`Tag ${tag} set for client: ${client.id}`);
    }
  }

  @SubscribeMessage("sendMessage")
  sendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { message: string; room: string },
  ) {
    const { message, room } = data;
    console.log(room, message);
    const blacklist = [
      // English words
      "heck",
      "darn",
      "bad",
      "sex",
      "porn",
      "explicit",
      "nude",
      "naked",
      "xxx",
      "adult",
      "erotic",
      "orgasm",
      "vagina",
      "penis",
      "boobs",
      "breasts",
      "butt",
      "anal",
      "masturbate",
      "dildo",
      "vibrator",
      "fetish",
      "bondage",
      "cum",
      "sperm",
      "ejaculate",
      "orgy",
      "gangbang",
      "swinger",
      "prostitute",
      "whore",
      "slut",
      "hooker",
      "escort",
      "stripper",
      "incest",
      "pedophile",
      "bestiality",
      "incest",
      "rape",
      "molestation",
      "child",
      "underage",
      "teen",
      "illegal",
      "drug",
      "meth",
      "heroin",
      "cocaine",
      "weed",
      "marijuana",
      "crack",
      "lsd",
      "ecstasy",
      "methamphetamine",
      "amphetamine",
      "opium",
      "hashish",
      "pills",
      "viagra",
      "cialis",
      "levitra",
      "prescription",
      "medicine",
      "pharmacy",
      "drugs",
      "pill",
      "opiate",
      "oxycontin",
      "xanax",
      "addiction",
      "rehab",
      "alcohol",
      "beer",
      "wine",
      "whiskey",
      "vodka",
      "rum",
      "tequila",
      "gin",
      "brandy",
      "sake",
      "liquor",
      // Hinglish words
      "lund",
      "chut",
      "randi",
      "bhosdi",
      "madarchod",
      "chutiya",
      "gandu",
      "behenchod",
      "betichod",
      "bhosdike",
      "harami",
      "choot",
      "kamine",
      "kutta",
      "bhosri",
      "loda",
      "raand",
      "hijda",
      "gand",
      // English spelling variants and misspellings
      "f*ck",
      "fck",
      "fuk",
      "fu*k",
      "f**k",
      "f@ck",
      "fuсk",
      "fucк",
      "fuсk",
      "fuϲk",
      "сock",
      "сum",
      "сunt",
      "d1ck",
      "dik",
      "d*ck",
      "d!ck",
      "d!k",
      "d!c",
      "d1c",
      "d1k",
      "сoсk",
      "сum",
      "сunt",
      "dick",
      "dic",
      "dik",
      "dikk",
      "diсk",
      "diс",
      "p*rn",
      "p0rn",
      "pr0n",
      "poгn",
      "po*n",
      "p*ssy",
      "p*ss",
      "pus*y",
      "pu$$y",
      "pus$y",
      "pharmacyy",
      "drugg",
      "pilll",
      "opiatee",
      "oxycontinn",
      "xanaxx",
      "sлut",
      "sluт",
      "sluƭ",
      "s!ut",
      "slut",
      "slu+t",
      "s1ut",
      "sluzt",
      "s1ut",
      "sh1t",
      "shiit",
      "shiт",
      "sh!t",
      "sh*t",
      "shii",
      "shiiit",
      "shiit",
      "shiit",
      "b1tch",
      "b!tch",
      "b!tch",
      "bitсh",
      "b1tch",
      "b!tch",
      "b!tch",
      "b!tch",
      "b!tch",
      "cocainee",
      "weedd",
      "marryjuana",
      "marjuanah",
      "coke",
      "crackk",
      "craсk",
      "ecstacy",
      "ecstaсy",
      "mathamphetamine",
      "addicti0n",
      "addictiоn",
      "addictiön",
      // Hinglish spelling variants and misspellings
      "lundd",
      "lunnd",
      "lond",
      "loond",
      "lundd",
      "lunddd",
      "chootia",
      "randii",
      "randee",
      "randi",
      "behancho",
      "behenchod",
      "madharchood",
      "madarchood",
      "choot",
      "chootia",
      "chootiya",
      "chutiya",
      "gaandu",
      "gaand",
      "gaandu",
      "gaandoo",
      "gaandu",
      "behanchood",
      "bhosri",
      "bhosdi",
      "bhonsri",
      "bhonsdi",
      "kutte",
      "kutti",
      "kutiya",
      "kamina",
      "kamine",
      "kameena",
      "chutiyaa",
      "hija",
      "hijde",
      "hijdo",
      "hijjra",
      "raand",
      "raandi",
      "raandwa",
      "loda",
      "lod",
    ];

    const censoredMessage = censorMessage(message, blacklist);
    client
      .to(room)
      .emit("message", { sender: client.id, message: censoredMessage });
    client.emit("message", { sender: client.id, message: censoredMessage });
  }

  @SubscribeMessage("sendGroupMessage")
  sendGroupMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { message: string; room: string },
  ) {
    const { message, room } = data;
    console.log("sending msz to room ", room);
    client.to(room).emit("message", { sender: client.id, message });
    client.emit("message", { sender: client.id, message });
  }
}
