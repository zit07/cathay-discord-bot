require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const http = require('http'); // Thêm thư viện tạo web server có sẵn

// Import các module của bạn [source: 4]
const CathayClient = require("./src/CathayClient");
const { parsePolicies } = require("./src/parser");
const createReport = require("./src/report");

// 1. TẠO WEB SERVER ĐỂ GIỮ CHO BOT LUÔN THỨC
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.write("Bot Cathay đang chạy 24/7!");
    res.end();
}).listen(process.env.PORT || 3000, () => {
    console.log("🖥️ Web server giữ mạng đã khởi động!");
});

// Khởi tạo bot Discord [source: 4]
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent 
    ]
});

client.once('clientReady', () => {
    console.log(`🤖 Bot Cathay đã sẵn sàng! Đăng nhập với tên: ${client.user.tag}`);
});

// Lắng nghe tin nhắn trong server [source: 4]
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const list = parsePolicies(message.content); // [source: 4]

    if (list.length === 0) return;

    await message.channel.sendTyping();
    const waitMessage = await message.reply("⏳ Phát hiện mã hợp đồng! Đang kết nối Cathay để kiểm tra, vui lòng đợi...");

    try {
        const cathay = new CathayClient(); // [source: 4]
        await cathay.init(); // [source: 4]
        const results = await cathay.checkPolicies(list); // [source: 4]

        const report = createReport(results); // [source: 4]

        // Vì bot chạy trên Render, ta chỉ cần edit thẳng tin nhắn kết quả (bỏ qua chia nhỏ nếu danh sách ngắn)
        await waitMessage.edit(report);

    } catch (error) {
        console.error("Lỗi hệ thống khi xử lý yêu cầu:", error);
        await waitMessage.edit(`❌ Đã xảy ra lỗi trong quá trình lấy dữ liệu: \`${error.message}\`. Vui lòng thử lại sau!`);
    }
});

// Đăng nhập bot [source: 4]
client.login(process.env.DISCORD_TOKEN);