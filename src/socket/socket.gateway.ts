import {
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
} from "@nestjs/websockets";
import { Server, Socket } from "socket.io";

interface TagAndClientVacant {
  [tag: string]: string;
}

const clientsAvailability = {};

const options = {
  cors: {
    origin: ["http://localhost:3000"],
    methods: ["GET", "POST"],
    credentials: true,
  },
};

@WebSocketGateway(options)
export class SocketGateway implements OnGatewayConnection {
  @WebSocketServer() server: Server;

  TagAndclientVacant: TagAndClientVacant = {};
  TagAndclientTaken: TagAndClientVacant = {};
  UserPairs = {};

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
    this.server.emit(
      "activeUsersCount",
      Object.keys(clientsAvailability).length,
    );
    const partnerClientId = this.UserPairs[client.id];
    if (!partnerClientId) return;
    const partnerClient = this.server.sockets.sockets.get(partnerClientId);
    partnerClient.emit("userLeft", client.id);
  }

  @SubscribeMessage("setTag")
  setTag(@ConnectedSocket() client: Socket, @MessageBody() tag: string) {
    console.log("tag of connecting user", tag);
    // Check if the tag already exists in TagAndclientVacant
    if (this.TagAndclientVacant[tag]) {
      // Get the socket ID of the matched client
      const matchedClientId = this.TagAndclientVacant[tag];
      // Delete the tag entry after matching
      delete this.TagAndclientVacant[tag];
      // Join a room with the matched client
      const room = `${client.id} and ${matchedClientId}`;
      client.join(room);
      const matchedClient = this.server.sockets.sockets.get(matchedClientId);
      if (matchedClient) {
        matchedClient.join(room);
        matchedClient.emit("matched", {
          room: room,
          mathcedUser: client.id,
        });
        client.emit("matched", {
          room: room,
          matcheddUser: matchedClient.id,
        });
      }
      console.log(
        `Client ${client.id} matched with ${matchedClient.id}. Room created: ${room}`,
      );
      this.UserPairs[matchedClientId] = client.id;
      this.UserPairs[client.id] = matchedClientId;
    } else {
      // If the tag doesn't exist, store it in TagAndclientVacant
      this.TagAndclientVacant[tag] = client.id;
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
    client.to(room).emit("message", { sender: client.id, message });
    client.emit("message", { sender: client.id, message });
  }
}
