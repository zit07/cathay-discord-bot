require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const http = require('http');

const CathayClient = require("./src/CathayClient");
const { parsePolicies } = require("./src/parser");
const createReport = require("./src/report");

const monitoringMap = new Map();

function money(n) {
    return new Intl.NumberFormat("vi-VN").format(n) + "đ";
}

/**
 * SỬA LỖI: Lọc kết quả chính xác theo vị trí Index 1:1 của danh sách gửi vào
 */
function filterResultsByMonth(results, list) {
    for (let i = 0; i < results.length; i++) {
        const r = results[i];
        if (!r || r.error) continue;
        
        const inputItem = list[i];
        const targetM = inputItem ? inputItem.targetMonth : null;
        
        if (targetM != null) {
            // Lọc danh sách nợ, chỉ giữ lại tháng trùng khớp chính xác
            r.items = r.items.filter(item => {
                const parts = item.date.split('-'); // YYYY-MM-DD
                if (parts.length >= 2) {
                    return parseInt(parts[1], 10) === targetM;
                }
                return false;
            });
            
            // Tính toán lại thông số sau khi lọc
            r.cathay = r.items.reduce((sum, item) => sum + item.amount, 0);
            r.paid = r.items.length === 0;
            
            if (inputItem.expected != null) {
                r.expected = inputItem.expected;
                r.diff = r.cathay - r.expected;
                if (r.cathay === r.expected) {
                    r.match = true;
                    r.mode = r.items.length === 1 ? "single" : "total";
                    r.diff = 0;
                } else {
                    r.match = false;
                }
            }
        }
    }
    return results;
}

// Web server giữ mạng
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.write("Bot Cathay đang chạy và giám sát 24/7!");
    res.end();
}).listen(process.env.PORT || 3000, () => {
    console.log("🖥️ Web server giữ mạng đã khởi động!");
});

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent 
    ]
});

client.once('ready', () => {
    console.log(`🤖 Bot Cathay đã sẵn sàng! Đăng nhập với tên: ${client.user.tag}`);
    setInterval(autoCheckSubscriptions, 60 * 1000);
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    let fileText = "";
    const txtAttachment = message.attachments.find(att => att.name.endsWith('.txt'));
    if (txtAttachment) {
        try {
            const response = await fetch(txtAttachment.url);
            fileText = await response.text();
        } catch (err) {
            console.error("Lỗi đọc file:", err.message);
        }
    }

    const combinedText = (message.content || "") + "\n" + fileText;
    const list = parsePolicies(combinedText);
    if (list.length === 0) return;

    await message.channel.sendTyping();
    const waitMessage = await message.reply("⏳ Phát hiện danh sách mã! Đang kết nối hệ thống quét dữ liệu, vui lòng đợi...");

    try {
        const cathay = new CathayClient();
        await cathay.init();
        let results = await cathay.checkPolicies(list);

        // Áp dụng bộ lọc sửa lỗi trùng lặp
        results = filterResultsByMonth(results, list);

        // 1. Gửi tin nhắn báo cáo chi tiết đầy đủ 🟢 và 🔴
        const report = createReport(results);
        await waitMessage.edit(report);

        // 2. Tạo tin nhắn riêng chứa các mã chưa thanh toán để copy (Đúng tháng chỉ định)
        const copyableLines = [];
        for (const r of results) {
            if (r.error || r.paid) continue;
            
            for (const item of r.items) {
                const month = parseInt(item.date.split('-')[1], 10);
                copyableLines.push(`${r.policy} (tháng${month}) ${money(item.amount).replace(/đ/g, '')}`);
            }
        }

        if (copyableLines.length > 0) {
            await message.channel.send(copyableLines.join('\n'));
        }

        // 3. Lưu trạng thái vào bộ nhớ quét ngầm
        for (let i = 0; i < results.length; i++) {
            const r = results[i];
            if (r.error) continue;

            const inputItem = list[i];
            const targetMonth = inputItem ? inputItem.targetMonth : null;

            if (!r.paid) {
                const unpaidItems = r.items.map(item => ({
                    date: item.date,
                    amount: item.amount
                }));
                
                monitoringMap.set(r.policy, {
                    expected: r.expected,
                    targetMonth: targetMonth,
                    unpaidItems: unpaidItems,
                    channelId: message.channel.id
                });
            } else {
                monitoringMap.delete(r.policy);
            }
        }

    } catch (error) {
        console.error("Lỗi xử lý:", error);
        await waitMessage.edit(`❌ Có lỗi xảy ra: \`${error.message}\``);
    }
});

async function autoCheckSubscriptions() {
    if (monitoringMap.size === 0) return;

    console.log(`[Auto-Check] Đang tiến hành kiểm tra ngầm ${monitoringMap.size} hợp đồng chưa thanh toán...`);

    const listToCheck = Array.from(monitoringMap.entries()).map(([policy, data]) => ({
        policy: policy,
        expected: data.expected,
        targetMonth: data.targetMonth
    }));

    try {
        const cathay = new CathayClient();
        await cathay.init();
        let results = await cathay.checkPolicies(listToCheck);

        results = filterResultsByMonth(results, listToCheck);

        for (const r of results) {
            if (r.error) continue;

            const savedData = monitoringMap.get(r.policy);
            if (!savedData) continue;

            const channel = await client.channels.fetch(savedData.channelId).catch(() => null);
            if (!channel) continue;

            if (r.paid) {
                for (const oldItem of savedData.unpaidItems) {
                    const month = parseInt(oldItem.date.split('-')[1], 10);
                    await channel.send(`🎉 **Mã ${r.policy}** (${money(oldItem.amount)}) đã thanh toán cước **tháng ${month}**!`);
                }
                monitoringMap.delete(r.policy);
            } else {
                const currentUnpaidDates = r.items.map(item => item.date);

                for (const oldItem of savedData.unpaidItems) {
                    if (!currentUnpaidDates.includes(oldItem.date)) {
                        const month = parseInt(oldItem.date.split('-')[1], 10);
                        await channel.send(`🎉 **Mã ${r.policy}** (${money(oldItem.amount)}) đã thanh toán cước **tháng ${month}**!`);
                    }
                }

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
        console.error("[Auto-Check] Lỗi quét ngầm:", err.message);
    }
}

client.login(process.env.DISCORD_TOKEN);