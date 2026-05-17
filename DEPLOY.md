# 🟣 Yahoo! 聊天室 — 部署完整教學

## 📁 專案結構
```
yahoo-chat/
├── server/
│   ├── index.js        # 後端主程式 (Express + Socket.IO)
│   ├── package.json
│   ├── railway.json    # Railway 設定
│   └── .env.example   # 環境變數範本
├── client/
│   └── public/
│       └── index.html  # 前端單頁應用
└── package.json
```

---

## 🗄️ 步驟一：建立線上資料庫（MongoDB Atlas）

1. 前往 https://www.mongodb.com/atlas/database
2. 點擊 **「Try Free」** → 用 Google 或 Email 註冊
3. 建立 **Free Cluster (M0)**
   - 選擇離你最近的地區（推薦 AWS ap-southeast-1 新加坡）
   - Cluster 名稱：`yahoo-chat`
4. 建立資料庫使用者：
   - Database Access → Add New Database User
   - 帳號：`yahoo_admin`  密碼：設定一個強密碼（記下來！）
   - 權限：Read and Write to any database
5. 設定網路存取（允許所有 IP）：
   - Network Access → Add IP Address
   - 選擇 **"Allow Access from Anywhere"** (0.0.0.0/0)
6. 取得連線字串：
   - Connect → Connect your application
   - Driver: Node.js 5.5 or later
   - 複製連線字串，格式類似：
     ```
     mongodb+srv://yahoo_admin:<password>@cluster0.xxxxx.mongodb.net/yahoo_chat
     ```
   - 把 `<password>` 替換成你設定的密碼

---

## 🚂 步驟二：部署到 Railway

### 2-1. 準備 GitHub 儲存庫
```bash
# 在 yahoo-chat 資料夾內執行
git init
git add .
git commit -m "Initial Yahoo! Chat clone"

# 到 https://github.com 建立新 repo (public or private)
# 命名：yahoo-chat
git remote add origin https://github.com/你的帳號/yahoo-chat.git
git push -u origin main
```

### 2-2. 部署到 Railway
1. 前往 https://railway.app
2. 點擊 **「Start a New Project」**
3. 選擇 **「Deploy from GitHub repo」**
4. 選擇 `yahoo-chat` 儲存庫
5. Railway 會自動偵測並開始建置

### 2-3. 設定環境變數
在 Railway 的 Variables 頁面新增：
```
MONGO_URI = mongodb+srv://yahoo_admin:你的密碼@cluster0.xxxxx.mongodb.net/yahoo_chat
JWT_SECRET = 輸入一個長串隨機字元（例如：xK9mN2pQ8rT5yW3uE7aB）
PORT = 3000
```

### 2-4. 取得你的網址
Railway 部署成功後，在 Settings → Networking 可以看到：
```
https://yahoo-chat-production.up.railway.app
```
這就是你的聊天室網址！

---

## 🌐 步驟三：申請網域名稱（Domain Name）

### 選項 A：Cloudflare（推薦，最便宜）
1. 前往 https://www.cloudflare.com/products/registrar/
2. 搜尋你想要的網域名稱（例如：`yahoochat.tw`、`mychat.fun`）
3. 台灣 .com 約 NT$300/年，.fun 約 NT$100/年
4. 購買並完成身份驗證

### 選項 B：Namecheap（英文介面，常有優惠）
1. 前往 https://www.namecheap.com
2. .com 約 US$10-15/年

### 綁定到 Railway：
1. 在 Railway → Settings → Networking → Custom Domain
2. 輸入你的網域名稱（例如：`chat.yourdomain.com`）
3. Railway 會給你一個 CNAME 記錄
4. 到 Cloudflare 的 DNS 設定新增 CNAME：
   ```
   Type: CNAME
   Name: chat（或 @）
   Target: 貼上 Railway 給你的值
   ```
5. 等 5-10 分鐘後網域就生效了！

---

## ✅ 功能清單

| 功能 | 說明 |
|------|------|
| 📝 帳號系統 | 註冊 / 登入 / JWT 驗證 |
| 💬 公開聊天室 | 多人即時聊天，含分類 |
| 📨 私訊（DM） | 一對一私人訊息 |
| 😀 表情符號 | 50+ Emoji + 日式顏文字 |
| 🎭 貼圖系統 | 32 種大型貼圖 |
| 🎨 字體顏色 | 16 色自訂文字顏色 |
| **B** / *I* | 粗體 / 斜體 格式化 |
| 👤 虛擬頭像 | 24 種動物/符號頭像 |
| 🟢 線上狀態 | 線上/離開/忙碌/隱身 |
| 👥 好友名單 | 搜尋用戶、加好友、接受邀請 |
| 🏠 建立聊天室 | 自訂名稱、分類、主題 |
| ⌨️ 打字提示 | 即時顯示對方正在輸入 |
| 🔔 未讀通知 | 私訊未讀徽章 |
| 💾 訊息歷史 | 聊天記錄保存在 MongoDB |

---

## 🔧 本地開發

```bash
# 安裝依賴
cd server
npm install

# 設定環境變數
cp .env.example .env
# 編輯 .env 填入你的 MONGO_URI

# 啟動伺服器
npm start

# 瀏覽器開啟
open http://localhost:3000
```

---

## 🚀 技術棧

- **後端**：Node.js + Express + Socket.IO
- **資料庫**：MongoDB Atlas（免費 512MB）
- **身份驗證**：JWT + bcrypt
- **即時通訊**：WebSocket (Socket.IO)
- **前端**：原生 HTML5 / CSS3 / JavaScript（無框架，零依賴）
- **部署**：Railway（免費方案含 $5/月 額度）
- **字型**：Google Fonts（Noto Sans TC + Press Start 2P）

---

## 💡 進階擴展建議

- 新增圖片/檔案傳送（使用 Cloudinary）
- 加入 Google OAuth 登入
- 新增語音/視訊聊天（WebRTC）
- 手機 App（包裝成 PWA）
- 更多貼圖包（可自訂上傳）
