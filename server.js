const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

app.use(express.static("public"));

const io = new Server(server, {
  cors: { origin: "*" }
});

let currentPdfPage = 1;
let currentLeader = null; // socket.id of current leader, or null

io.on("connection", (socket) => {
  console.log("client connected:", socket.id);

  socket.emit("pdf:init", { page: currentPdfPage });
  if (currentLeader) {
    io.to(socket.id).emit("leader:changed", { leaderId: currentLeader, page: currentPdfPage });
  }

  socket.on("pdf:become-leader", (pageNum) => {
    const p = parseInt(pageNum, 10) || currentPdfPage;
    // If the same socket already leader -> ignore
    if (currentLeader === socket.id) {
      socket.emit("leader:changed", { leaderId: currentLeader, page: p });
      return;
    }

    currentLeader = socket.id;
    currentPdfPage = p >= 1 ? p : currentPdfPage;

    io.emit("leader:changed", { leaderId: currentLeader, page: currentPdfPage });
    io.emit("pdf:page", currentPdfPage);

    console.log("New leader:", currentLeader, "page:", currentPdfPage);
  });

  socket.on("pdf:page", (pageNum) => {
    const p = parseInt(pageNum, 10);
    if (Number.isInteger(p) && p >= 1) {
      currentPdfPage = p;
      // only broadcast page changes (don't touch leader here)
      io.emit("pdf:page", currentPdfPage);
      console.log("Page changed to", currentPdfPage);
    }
  });

  socket.on("disconnect", () => {
    console.log("client disconnected:", socket.id);
    // if the leader left, clear and notify
    if (socket.id === currentLeader) {
      currentLeader = null;
      io.emit("leader:left"); 
      console.log("Leader disconnected, cleared leader");
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log("Open from another device via your LAN IP, e.g. http://192.168.1.50:3000");
});
