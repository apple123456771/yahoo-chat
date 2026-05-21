const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const multer = require('multer');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET', 'POST'] } });

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Avatar upload storage
const storage = multer.diskStorage({
  destination: function(req, file, cb) {
    cb(null, path.join(__dirname, 'client/public/avatars'));
  },
  filename: function(req, file, cb) {
    cb(null, uuidv4() + path.extname(file.originalname));
  }
});
const upload = multer({ storage: storage, limits: { fileSize: 2 * 1024 * 1024 } });

// ─── Schemas ──────────────────────────────────────────────────────────────────
const userSchema = new mongoose.Schema({
  username:    { type: String, unique: true, required: true },
  password:    { type: String, required: true },
  nickname:    { type: String, default: '' },
  avatar:      { type: String, default: '😺' },
  avatarType:  { type: String, default: 'emoji', enum: ['emoji', 'image'] },
  avatarUrl:   { type: String, default: '' },
  avatarColor: { type: String, default: '#FFD700' },
  status:      { type: String, default: 'online', enum: ['online','away','busy','invisible'] },
  statusMsg:   { type: String, default: '' },
  friends:     [{ type: String }],
  friendRequests: [{ type: String }],
  customStickers: [{ type: String }],
  chatBg:      { type: String, default: 'default' },
  createdAt:   { type: Date, default: Date.now }
});

const roomSchema = new mongoose.Schema({
  name:      { type: String, unique: true, required: true },
  topic:     { type: String, default: '' },
  category:  { type: String, default: '一般' },
  isPrivate: { type: Boolean, default: false },
  owner:     { type: String, default: 'system' },
  createdAt: { type: Date, default: Date.now }
});

const messageSchema = new mongoose.Schema({
  id:        { type: String, default: uuidv4 },
  room:      { type: String },
  from:      { type: String },
  to:        { type: String },
  type:      { type: String, default: 'text', enum: ['text','emote','sticker','system'] },
  content:   { type: String, required: true },
  color:     { type: String, default: '#f0e6ff' },
  bold:      { type: Boolean, default: false },
  italic:    { type: Boolean, default: false },
  fontSize:  { type: String, default: '14px' },
  readBy:    [{ type: String }],
  delivered: [{ type: String }],
  timestamp: { type: Date, default: Date.now }
});

const User    = mongoose.model('User',    userSchema);
const Room    = mongoose.model('Room',    roomSchema);
const Message = mongoose.model('Message', messageSchema);

// ─── Auth ─────────────────────────────────────────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET || 'yahoo_chat_secret_2024';
const signToken = function(u) { return jwt.sign({ id: u._id, username: u.username }, JWT_SECRET, { expiresIn: '7d' }); };
const auth = function(req, res, next) {
  var token = req.headers.authorization && req.headers.authorization.split(' ')[1];
  if (!token) return res.status(401).json({ error: '未授權' });
  try { req.user = jwt.verify(token, JWT_SECRET); next(); }
  catch(e) { res.status(401).json({ error: 'Token 無效' }); }
};
function safeUser(u) {
  return { id: u._id, username: u.username, nickname: u.nickname, avatar: u.avatar, avatarType: u.avatarType, avatarUrl: u.avatarUrl, avatarColor: u.avatarColor, status: u.status, statusMsg: u.statusMsg, friends: u.friends, friendRequests: u.friendRequests, customStickers: u.customStickers || [], chatBg: u.chatBg || 'default' };
}

// ─── API Routes ───────────────────────────────────────────────────────────────
app.post('/api/register', async function(req, res) {
  try {
    var username = req.body.username, password = req.body.password, nickname = req.body.nickname;
    if (!username || !password) return res.status(400).json({ error: '帳號密碼必填' });
    if (await User.findOne({ username: username })) return res.status(409).json({ error: '帳號已存在' });
    var hashed = await bcrypt.hash(password, 10);
    var user = await User.create({ username: username, password: hashed, nickname: nickname || username });
    res.json({ token: signToken(user), user: safeUser(user) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/login', async function(req, res) {
  try {
    var user = await User.findOne({ username: req.body.username });
    if (!user) return res.status(401).json({ error: '帳號不存在' });
    if (!await bcrypt.compare(req.body.password, user.password)) return res.status(401).json({ error: '密碼錯誤' });
    res.json({ token: signToken(user), user: safeUser(user) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/me', auth, async function(req, res) {
  var user = await User.findById(req.user.id);
  if (!user) return res.status(404).json({ error: '找不到使用者' });
  res.json(safeUser(user));
});

app.put('/api/me', auth, async function(req, res) {
  var b = req.body;
  var user = await User.findByIdAndUpdate(req.user.id, { nickname: b.nickname, avatar: b.avatar, avatarType: b.avatarType, avatarUrl: b.avatarUrl, avatarColor: b.avatarColor, status: b.status, statusMsg: b.statusMsg, chatBg: b.chatBg }, { new: true });
  res.json(safeUser(user));
});

// Avatar image upload
app.post('/api/avatar', auth, upload.single('avatar'), async function(req, res) {
  try {
    if (!req.file) return res.status(400).json({ error: '未上傳檔案' });
    var url = '/avatars/' + req.file.filename;
    var user = await User.findByIdAndUpdate(req.user.id, { avatarType: 'image', avatarUrl: url }, { new: true });
    io.emit('user:avatarUpdate', { username: user.username, avatarType: 'image', avatarUrl: url });
    res.json({ url: url, user: safeUser(user) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Custom stickers
app.post('/api/stickers', auth, async function(req, res) {
  var sticker = req.body.sticker;
  if (!sticker) return res.status(400).json({ error: '缺少貼圖' });
  var user = await User.findById(req.user.id);
  if (user.customStickers.length >= 30) return res.status(400).json({ error: '最多 30 個自訂貼圖' });
  user.customStickers.push(sticker);
  await user.save();
  res.json({ stickers: user.customStickers });
});

app.delete('/api/stickers', auth, async function(req, res) {
  var sticker = req.body.sticker;
  var user = await User.findById(req.user.id);
  user.customStickers = user.customStickers.filter(function(s) { return s !== sticker; });
  await user.save();
  res.json({ stickers: user.customStickers });
});

app.get('/api/rooms', async function(req, res) {
  res.json(await Room.find({ isPrivate: false }));
});

app.post('/api/rooms', auth, async function(req, res) {
  try {
    var room = await Room.create({ name: req.body.name, topic: req.body.topic, category: req.body.category, owner: req.user.username });
    io.emit('room:new', room);
    res.json(room);
  } catch(e) { res.status(400).json({ error: '聊天室名稱已存在' }); }
});

app.get('/api/messages/:room', auth, async function(req, res) {
  var msgs = await Message.find({ room: req.params.room }).sort({ timestamp: -1 }).limit(100);
  res.json(msgs.reverse());
});

app.get('/api/dm/:user', auth, async function(req, res) {
  var me = req.user.username, other = req.params.user;
  var msgs = await Message.find({ $or: [{ from: me, to: other }, { from: other, to: me }] }).sort({ timestamp: -1 }).limit(100);
  // Mark as read
  await Message.updateMany({ from: other, to: me, readBy: { $ne: me } }, { $push: { readBy: me } });
  res.json(msgs.reverse());
});

// Search messages
app.get('/api/search', auth, async function(req, res) {
  var q = req.query.q;
  if (!q) return res.json([]);
  var me = req.user.username;
  var msgs = await Message.find({
    content: { $regex: q, $options: 'i' },
    $or: [{ room: { $exists: true, $ne: '' } }, { from: me }, { to: me }]
  }).sort({ timestamp: -1 }).limit(30);
  res.json(msgs);
});

app.post('/api/friends/request', auth, async function(req, res) {
  var target = await User.findOne({ username: req.body.username });
  if (!target) return res.status(404).json({ error: '找不到使用者' });
  if (!target.friendRequests.includes(req.user.username)) {
    target.friendRequests.push(req.user.username);
    await target.save();
    // Notify target via socket
    var targetSockets = userSockets.get(target.username);
    if (targetSockets) {
      targetSockets.forEach(function(sid) {
        io.to(sid).emit('friend:request', { from: req.user.username });
      });
    }
  }
  res.json({ ok: true });
});

app.post('/api/friends/accept', auth, async function(req, res) {
  var me = await User.findById(req.user.id);
  var other = await User.findOne({ username: req.body.username });
  if (!me.friends.includes(req.body.username)) me.friends.push(req.body.username);
  me.friendRequests = me.friendRequests.filter(function(u) { return u !== req.body.username; });
  if (!other.friends.includes(me.username)) other.friends.push(me.username);
  await me.save(); await other.save();
  res.json({ ok: true });
});

app.post('/api/friends/reject', auth, async function(req, res) {
  var me = await User.findById(req.user.id);
  me.friendRequests = me.friendRequests.filter(function(u) { return u !== req.body.username; });
  await me.save();
  res.json({ ok: true });
});

app.get('/api/friends', auth, async function(req, res) {
  var me = await User.findById(req.user.id);
  res.json({ friends: me.friends, requests: me.friendRequests });
});

app.get('/api/users/search', auth, async function(req, res) {
  if (!req.query.q) return res.json([]);
  var users = await User.find({ username: { $regex: req.query.q, $options: 'i' } }).limit(10);
  res.json(users.map(safeUser));
});

// Mark DM as read
app.post('/api/dm/read', auth, async function(req, res) {
  var me = req.user.username, other = req.body.username;
  await Message.updateMany({ from: other, to: me, readBy: { $ne: me } }, { $push: { readBy: me } });
  // Notify sender
  var sockets = userSockets.get(other);
  if (sockets) sockets.forEach(function(sid) { io.to(sid).emit('dm:read', { by: me, from: other }); });
  res.json({ ok: true });
});

// ─── Static (MUST be after API routes) ───────────────────────────────────────
app.use(express.static(path.join(__dirname, 'client/public')));
app.get('*', function(req, res) {
  res.sendFile(path.join(__dirname, 'client/public/index.html'));
});

// ─── Socket.IO ────────────────────────────────────────────────────────────────
var onlineUsers = new Map();
var userSockets = new Map();

io.use(function(socket, next) {
  var token = socket.handshake.auth.token;
  if (!token) return next(new Error('未授權'));
  try { socket.user = jwt.verify(token, JWT_SECRET); next(); }
  catch(e) { next(new Error('Token 無效')); }
});

io.on('connection', function(socket) {
  var username = socket.user.username;
  onlineUsers.set(socket.id, { username: username });
  if (!userSockets.has(username)) userSockets.set(username, new Set());
  userSockets.get(username).add(socket.id);
  io.emit('users:online', Array.from(new Set(Array.from(onlineUsers.values()).map(function(u) { return u.username; }))));

  socket.on('room:join', async function(data) {
    socket.join(data.room);
    var msgs = await Message.find({ room: data.room }).sort({ timestamp: -1 }).limit(100);
    socket.emit('room:history', { room: data.room, messages: msgs.reverse() });
    io.to(data.room).emit('message:room', { id: uuidv4(), room: data.room, from: 'System', type: 'system', content: username + ' 進入了聊天室', timestamp: new Date() });
  });

  socket.on('room:leave', function(data) {
    socket.leave(data.room);
    io.to(data.room).emit('message:room', { id: uuidv4(), room: data.room, from: 'System', type: 'system', content: username + ' 離開了聊天室', timestamp: new Date() });
  });

  socket.on('message:room', async function(data) {
    var msg = await Message.create({ id: uuidv4(), room: data.room, from: username, type: data.type || 'text', content: data.content, color: data.color, bold: data.bold, italic: data.italic, fontSize: data.fontSize, readBy: [username] });
    io.to(data.room).emit('message:room', msg);
  });

  socket.on('message:dm', async function(data) {
    var msg = await Message.create({ id: uuidv4(), from: username, to: data.to, type: data.type || 'text', content: data.content, color: data.color, bold: data.bold, italic: data.italic, fontSize: data.fontSize, readBy: [username], delivered: [username] });
    var targetSockets = userSockets.get(data.to);
    if (targetSockets) {
      targetSockets.forEach(function(sid) { io.to(sid).emit('message:dm', msg); });
      // Auto mark delivered
      await Message.findByIdAndUpdate(msg._id, { $addToSet: { delivered: data.to } });
      msg.delivered = [username, data.to];
      // Re-emit with delivered status
      socket.emit('dm:delivered', { msgId: msg.id, to: data.to });
    }
    socket.emit('message:dm', msg);
  });

  socket.on('dm:read', async function(data) {
    var other = data.from;
    await Message.updateMany({ from: other, to: username, readBy: { $ne: username } }, { $push: { readBy: username } });
    var sockets = userSockets.get(other);
    if (sockets) sockets.forEach(function(sid) { io.to(sid).emit('dm:read', { by: username, from: other }); });
  });

  socket.on('typing:room', function(data) { socket.to(data.room).emit('typing:room', { username: username, isTyping: data.isTyping }); });
  socket.on('typing:dm', function(data) {
    var s = userSockets.get(data.to);
    if (s) s.forEach(function(sid) { io.to(sid).emit('typing:dm', { username: username, isTyping: data.isTyping }); });
  });
  socket.on('user:status', async function(data) {
    await User.findOneAndUpdate({ username: username }, { status: data.status, statusMsg: data.statusMsg });
    io.emit('user:status', { username: username, status: data.status, statusMsg: data.statusMsg });
  });
  socket.on('disconnect', function() {
    onlineUsers.delete(socket.id);
    var s = userSockets.get(username);
    if (s) { s.delete(socket.id); if (s.size === 0) userSockets.delete(username); }
    io.emit('users:online', Array.from(new Set(Array.from(onlineUsers.values()).map(function(u) { return u.username; }))));
  });
});

// ─── Seed & Start ─────────────────────────────────────────────────────────────
async function seedRooms() {
  var defaults = [
    { name: '大廳', topic: '歡迎來到 Yahoo! 聊天室', category: '一般' },
    { name: '音樂天地', topic: '分享你喜愛的音樂', category: '娛樂' },
    { name: '電影討論', topic: '最新電影心得', category: '娛樂' },
    { name: '電玩遊戲', topic: '遊戲攻略交流', category: '娛樂' },
    { name: '旅遊分享', topic: '交流旅遊心得', category: '生活' },
    { name: '美食交流', topic: '推薦好吃的料理', category: '生活' },
  ];
  for (var i = 0; i < defaults.length; i++) {
    await Room.findOneAndUpdate({ name: defaults[i].name }, defaults[i], { upsert: true });
  }
}

var fs = require('fs');
var avatarDir = path.join(__dirname, 'client/public/avatars');
if (!fs.existsSync(avatarDir)) fs.mkdirSync(avatarDir, { recursive: true });

var MONGO_URI = process.env.MONGO_URI || 'mongodb+srv://apple123456771_db_user:QACputd5f2NkqEaq@cluster0.vcs7dpb.mongodb.net/yahoo_chat?appName=Cluster0';
var PORT = process.env.PORT || 8080;

mongoose.connect(MONGO_URI)
  .then(async function() {
    await seedRooms();
    console.log('✅ MongoDB 已連線');
    server.listen(PORT, function() { console.log('🚀 伺服器啟動於 port ' + PORT); });
  })
  .catch(function(e) { console.error('❌ MongoDB 連線失敗:', e.message); process.exit(1); });
