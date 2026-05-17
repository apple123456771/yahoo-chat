const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

app.use(cors());
app.use(express.json());
app.use(express.static('../client/public'));

const userSchema = new mongoose.Schema({
  username:  { type: String, unique: true, required: true },
  password:  { type: String, required: true },
  nickname:  { type: String, default: '' },
  avatar:    { type: String, default: 'cat' },
  avatarColor: { type: String, default: '#FFD700' },
  status:    { type: String, default: 'online', enum: ['online','away','busy','invisible'] },
  statusMsg: { type: String, default: '' },
  friends:   [{ type: String }],
  friendRequests: [{ type: String }],
  createdAt: { type: Date, default: Date.now }
});

const roomSchema = new mongoose.Schema({
  name:     { type: String, unique: true, required: true },
  topic:    { type: String, default: '' },
  category: { type: String, default: '一般' },
  isPrivate: { type: Boolean, default: false },
  owner:    { type: String, default: 'system' },
  createdAt: { type: Date, default: Date.now }
});

const messageSchema = new mongoose.Schema({
  id:       { type: String, default: uuidv4 },
  room:     { type: String },
  from:     { type: String },
  to:       { type: String },
  type:     { type: String, default: 'text', enum: ['text','emote','sticker','system'] },
  content:  { type: String, required: true },
  color:    { type: String, default: '#000000' },
  bold:     { type: Boolean, default: false },
  italic:   { type: Boolean, default: false },
  timestamp: { type: Date, default: Date.now }
});

const User    = mongoose.model('User',    userSchema);
const Room    = mongoose.model('Room',    roomSchema);
const Message = mongoose.model('Message', messageSchema);

const JWT_SECRET = process.env.JWT_SECRET || 'yahoo_chat_secret_2024';
const signToken  = (u) => jwt.sign({ id: u._id, username: u.username }, JWT_SECRET, { expiresIn: '7d' });
const authMiddleware = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: '未授權' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Token 無效' }); }
};

app.post('/api/register', async (req, res) => {
  try {
    const { username, password, nickname } = req.body;
    if (!username || !password) return res.status(400).json({ error: '帳號密碼必填' });
    const exists = await User.findOne({ username });
    if (exists) return res.status(409).json({ error: '帳號已存在' });
    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({ username, password: hashed, nickname: nickname || username });
    res.json({ token: signToken(user), user: safeUser(user) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (!user) return res.status(401).json({ error: '帳號不存在' });
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: '密碼錯誤' });
    res.json({ token: signToken(user), user: safeUser(user) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/me', authMiddleware, async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) return res.status(404).json({ error: '找不到使用者' });
  res.json(safeUser(user));
});

app.put('/api/me', authMiddleware, async (req, res) => {
  const { nickname, avatar, avatarColor, status, statusMsg } = req.body;
  const user = await User.findByIdAndUpdate(req.user.id, { nickname, avatar, avatarColor, status, statusMsg }, { new: true });
  res.json(safeUser(user));
});

app.get('/api/rooms', async (req, res) => {
  const rooms = await Room.find({ isPrivate: false });
  res.json(rooms);
});

app.post('/api/rooms', authMiddleware, async (req, res) => {
  try {
    const { name, topic, category } = req.body;
    const room = await Room.create({ name, topic, category, owner: req.user.username });
    io.emit('room:new', room);
    res.json(room);
  } catch(e) { res.status(400).json({ error: '聊天室名稱已存在' }); }
});

app.get('/api/messages/:room', authMiddleware, async (req, res) => {
  const msgs = await Message.find({ room: req.params.room }).sort({ timestamp: -1 }).limit(50);
  res.json(msgs.reverse());
});

app.get('/api/dm/:user', authMiddleware, async (req, res) => {
  const me = req.user.username;
  const other = req.params.user;
  const msgs = await Message.find({
    $or: [{ from: me, to: other }, { from: other, to: me }]
  }).sort({ timestamp: -1 }).limit(50);
  res.json(msgs.reverse());
});

app.post('/api/friends/request', authMiddleware, async (req, res) => {
  const { username } = req.body;
  const target = await User.findOne({ username });
  if (!target) return res.status(404).json({ error: '找不到使用者' });
  if (!target.friendRequests.includes(req.user.username)) {
    target.friendRequests.push(req.user.username);
    await target.save();
  }
  res.json({ ok: true });
});

app.post('/api/friends/accept', authMiddleware, async (req, res) => {
  const { username } = req.body;
  const me = await User.findById(req.user.id);
  const other = await User.findOne({ username });
  me.friends.push(username);
  me.friendRequests = me.friendRequests.filter(u => u !== username);
  other.friends.push(me.username);
  await me.save(); await other.save();
  res.json({ ok: true });
});

app.get('/api/friends', authMiddleware, async (req, res) => {
  const me = await User.findById(req.user.id);
  res.json({ friends: me.friends, requests: me.friendRequests });
});

app.get('/api/users/search', authMiddleware, async (req, res) => {
  const { q } = req.query;
  const users = await User.find({ username: { $regex: q, $options: 'i' } }).limit(10);
  res.json(users.map(safeUser));
});

function safeUser(u) {
  return { id: u._id, username: u.username, nickname: u.nickname, avatar: u.avatar, avatarColor: u.avatarColor, status: u.status, statusMsg: u.statusMsg, friends: u.friends, friendRequests: u.friendRequests };
}

const onlineUsers = new Map();
const userSockets = new Map();

io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error('未授權'));
  try { socket.user = jwt.verify(token, JWT_SECRET); next(); }
  catch { next(new Error('Token 無效')); }
});

io.on('connection', (socket) => {
  const { username } = socket.user;
  onlineUsers.set(socket.id, { username, socketId: socket.id });
  if (!userSockets.has(username)) userSockets.set(username, new Set());
  userSockets.get(username).add(socket.id);

  io.emit('users:online', [...new Set([...onlineUsers.values()].map(u => u.username))]);

  socket.on('room:join', async ({ room }) => {
    socket.join(room);
    const msgs = await Message.find({ room }).sort({ timestamp: -1 }).limit(50);
    socket.emit('room:history', { room, messages: msgs.reverse() });
    const sysMsg = { id: uuidv4(), room, from: 'System', type: 'system', content: `${username} 進入了聊天室`, timestamp: new Date() };
    io.to(room).emit('message:room', sysMsg);
  });

  socket.on('room:leave', ({ room }) => {
    socket.leave(room);
    const sysMsg = { id: uuidv4(), room, from: 'System', type: 'system', content: `${username} 離開了聊天室`, timestamp: new Date() };
    io.to(room).emit('message:room', sysMsg);
  });

  socket.on('message:room', async ({ room, content, type = 'text', color, bold, italic }) => {
    const msg = await Message.create({ id: uuidv4(), room, from: username, type, content, color, bold, italic });
    io.to(room).emit('message:room', msg);
  });

  socket.on('message:dm', async ({ to, content, type = 'text', color, bold, italic }) => {
    const msg = await Message.create({ id: uuidv4(), from: username, to, type, content, color, bold, italic });
    const targetSockets = userSockets.get(to);
    if (targetSockets) targetSockets.forEach(sid => io.to(sid).emit('message:dm', msg));
    socket.emit('message:dm', msg);
  });

  socket.on('typing:room', ({ room, isTyping }) => {
    socket.to(room).emit('typing:room', { username, isTyping });
  });

  socket.on('typing:dm', ({ to, isTyping }) => {
    const targetSockets = userSockets.get(to);
    if (targetSockets) targetSockets.forEach(sid => io.to(sid).emit('typing:dm', { username, isTyping }));
  });

  socket.on('user:status', async ({ status, statusMsg }) => {
    await User.findOneAndUpdate({ username }, { status, statusMsg });
    io.emit('user:status', { username, status, statusMsg });
  });

  socket.on('disconnect', () => {
    onlineUsers.delete(socket.id);
    const sockets = userSockets.get(username);
    if (sockets) { sockets.delete(socket.id); if (sockets.size === 0) userSockets.delete(username); }
    io.emit('users:online', [...new Set([...onlineUsers.values()].map(u => u.username))]);
  });
});

async function seedRooms() {
  const defaults = [
    { name: '大廳', topic: '歡迎來到 Yahoo! 聊天室', category: '一般' },
    { name: '音樂天地', topic: '分享你喜愛的音樂', category: '娛樂' },
    { name: '電影討論', topic: '最新電影心得', category: '娛樂' },
    { name: '電玩遊戲', topic: '遊戲攻略交流', category: '娛樂' },
    { name: '旅遊分享', topic: '交流旅遊心得', category: '生活' },
    { name: '美食交流', topic: '推薦好吃的料理', category: '生活' },
  ];
  for (const r of defaults) {
    await Room.findOneAndUpdate({ name: r.name }, r, { upsert: true });
  }
}

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/yahoo_chat';
const PORT      = process.env.PORT || 3000;

mongoose.connect(MONGO_URI)
  .then(async () => {
    await seedRooms();
    console.log('✅ MongoDB 已連線');
    server.listen(PORT, () => console.log(`🚀 伺服器啟動於 port ${PORT}`));
  })
  .catch(e => { console.error('❌ MongoDB 連線失敗:', e.message); process.exit(1); });
