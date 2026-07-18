require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const http = require('http');

// Import các module của bạn
const CathayClient = require("./src/CathayClient");
const { parsePolicies } = require("./src/parser");
const createReport = require("./src/report");

// BỘ NHỚ TẠM ĐỂ THEO DÕI HỢP ĐỒNG TRONG NGÀY
// Cấu trúc mới: Key = Mã hợp đồng, Value = { expected, unpaidItems: [{date, amount}], channelId }
const monitoringMap = new Map();

// Hàm định dạng số tiền (Ví dụ: 1400000 -> 1.400.000đ)
function money(n) {
    return new Intl.NumberFormat("vi-VN").format(n) + "đ";
}

// Web server giữ mạng cho Render
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.write("Bot Cathay đang chạy và giám sát 24/7!");
    res.end();
}).listen(process.env.PORT || 3000, () => {
    console.log("🖥️ Web server giữ mạng đã khởi động!");
});

// Khởi tạo bot Discord
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent 
    ]
});

client.once('ready', () => {
    console.log(`🤖 Bot Cathay đã sẵn sàng! Đăng nhập với tên: ${client.user.tag}`);
    // Kích hoạt vòng lặp kiểm tra tự động mỗi 1 phút
    setInterval(autoCheckSubscriptions, 60 * 1000);
});

// Lắng nghe tin nhắn từ người dùng
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const list = parsePolicies(message.content);
    if (list.length === 0) return;

    await message.channel.sendTyping();
    const waitMessage = await message.reply("⏳ Phát hiện mã hợp đồng! Đang quét dữ liệu ban đầu, vui lòng đợi...");

    try {
        const cathay = new CathayClient();
        await cathay.init();
        const results = await cathay.checkPolicies(list);

        // Xuất báo cáo hiện tại ra Discord
        const report = createReport(results);
        await waitMessage.edit(report);

        // TỰ ĐỘNG LƯU TRẠNG THÁI CHI TIẾT (CẢ NGÀY VÀ SỐ TIỀN) VÀO BỘ NHỚ
        for (const r of results) {
            if (r.error) continue;

            if (!r.paid) {
                // Lưu cấu trúc mảng đối tượng chứa cả ngày và số tiền của từng kỳ nợ
                const unpaidItems = r.items.map(item => ({
                    date: item.date,
                    amount: item.amount
                }));
                
                monitoringMap.set(r.policy, {
                    expected: r.expected,
                    unpaidItems: unpaidItems,
                    channelId: message.channel.id
                });
                console.log(`[Giám sát] Đã thêm/cập nhật mã: ${r.policy} (Còn nợ ${unpaidItems.length} kỳ)`);
            } else {
                monitoringMap.delete(r.policy);
            }
        }

    } catch (error) {
        console.error("Lỗi khi xử lý tin nhắn đầu vào:", error);
        await waitMessage.edit(`❌ Có lỗi xảy ra: \`${error.message}\``);
    }
});

/**
 * HÀM TỰ ĐỘNG CHẠY NGẦM MỖI PHÚT ĐỂ QUÉT CÁC ĐƠN CHƯA THANH TOÁN
 */
async function autoCheckSubscriptions() {
    if (monitoringMap.size === 0) return;

    console.log(`[Auto-Check] Đang tiến hành kiểm tra ngầm ${monitoringMap.size} hợp đồng chưa thanh toán...`);

    const listToCheck = Array.from(monitoringMap.entries()).map(([policy, data]) => ({
        policy: policy,
        expected: data.expected
    }));

    try {
        const cathay = new CathayClient();
        await cathay.init();
        const results = await cathay.checkPolicies(listToCheck);

        for (const r of results) {
            if (r.error) continue;

            const savedData = monitoringMap.get(r.policy);
            if (!savedData) continue;

            const channel = await client.channels.fetch(savedData.channelId).catch(() => null);
            if (!channel) continue;

            if (r.paid) {
                // TRƯỜNG HỢP 1: ĐƠN CHUYỂN THÀNH ĐÃ THANH TOÁN HOÀN TOÀN
                for (const oldItem of savedData.unpaidItems) {
                    const month = parseInt(oldItem.date.split('-')[1], 10);
                    await channel.send(`🎉 **Mã ${r.policy}** (${money(oldItem.amount)}) đã thanh toán cước **tháng ${month}**!`);
                }
                monitoringMap.delete(r.policy);
                console.log(`[Giám sát] Đã xóa ${r.policy} vì đã thanh toán hết.`);
            } else {
                // TRƯỜNG HỢP 2: VẪN CÒN CƯỚC, KIỂM TRA XEM CÓ THÁNG NÀO VỪA ĐƯỢC ĐÓNG KHÔNG
                const currentUnpaidDates = r.items.map(item => item.date);

                for (const oldItem of savedData.unpaidItems) {
                    // Nếu ngày nợ cũ không còn xuất hiện trong danh sách nợ mới nữa -> Đã đóng tiền tháng đó!
                    if (!currentUnpaidDates.includes(oldItem.date)) {
                        const month = parseInt(oldItem.date.split('-')[1], 10);
                        await channel.send(`🎉 **Mã ${r.policy}** (${money(oldItem.amount)}) đã thanh toán cước **tháng ${month}**!`);
                    }
                }

                // Cập nhật lại danh sách đối tượng nợ mới vào bộ nhớ
                const currentUnpaidItems = r.items.map(item => ({
                    date: item.date,
                    amount: item.amount
                }));

                if (currentUnpaidItems.length === 0) {
                    monitoringMap.delete(r.policy);
                } else {
                    savedData.unpaidItems = currentUnpaidItems;
                    monitoringMap.set(r.policy, savedData);
                }
            }
        }
    } catch (err) {
        console.error("[Auto-Check] Lỗi trong quá trình quét ngầm:", err.message);
    }
}

// Đăng nhập bot
client.login(process.env.DISCORD_TOKEN);