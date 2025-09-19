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

io.on("connection", (socket) => {
  console.log("client connected:", socket.id);

  socket.emit("pdf:init", { page: currentPdfPage });

  socket.on("pdf:page", (pageNum) => {
    const p = parseInt(pageNum, 10);
    if (Number.isInteger(p) && p >= 1) {
      currentPdfPage = p;
      io.emit("pdf:page", currentPdfPage);
      console.log("Page changed to", currentPdfPage);
    }
  });

  socket.on("disconnect", () => {
    console.log("client disconnected:", socket.id);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log("Open from another device via your LAN IP, e.g. http://192.168.1.50:3000");
});
