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
 * Bộ lọc cước thông minh: Chỉ giữ lại kỳ cước thuộc tháng chỉ định
 */
function filterResultsByMonth(results) {
    if (!results || !Array.isArray(results)) return [];
    
    for (const r of results) {
        if (!r || r.error) continue;
        
        // Nếu dòng này có chỉ định tháng cụ thể (ví dụ: tháng 6)
        if (r.targetMonth != null && Array.isArray(r.items)) {
            r.items = r.items.filter(item => {
                if (!item || !item.date) return false;
                const parts = item.date.split('-'); // YYYY-MM-DD
                if (parts.length >= 2) {
                    return parseInt(parts[1], 10) === r.targetMonth;
                }
                return false;
            });
        }
        
        // Tính toán lại tổng số tiền và trạng thái Đóng/Nợ sau khi lọc cước tháng
        r.cathay = r.items ? r.items.reduce((sum, item) => sum + (item.amount || 0), 0) : 0;
        r.paid = !r.items || r.items.length === 0;
        
        if (r.expected != null) {
            r.diff = r.cathay - r.expected;
            r.match = (r.cathay === r.expected);
            if (r.match) {
                r.diff = 0;
            }
        }
    }
    return results;
}

// Khởi tạo Web Server giữ mạng Render
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.write("Bot Cathay đang chạy ổn định!");
    res.end();
}).listen(process.env.PORT || 3000, () => {
    console.log("🖥️ Web server giữ mạng đã hoạt động!");
});

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent 
    ]
});

const handleReady = (c) => {
    console.log(`🤖 Bot Cathay đã online thành công: ${c?.user?.tag || client?.user?.tag}`);
    if (!client.autoCheckInterval) {
        client.autoCheckInterval = setInterval(autoCheckSubscriptions, 60 * 1000);
    }
};
client.once('ready', handleReady);
client.once('clientReady', handleReady);

client.on('messageCreate', async (message) => {
    try {
        if (message.author.bot) return;

        let fileText = "";
        const txtAttachment = message.attachments.find(att => att.name.endsWith('.txt'));
        if (txtAttachment) {
            try { const response = await fetch(txtAttachment.url); fileText = await response.text(); } catch (err) { console.error(err); }
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

            // SỬA LỖI TRÙNG LẶP: Ép cấu hình ghim tháng 1:1 theo đúng vị trí hàng đầu vào
            for (let i = 0; i < results.length; i++) {
                if (results[i] && list[i]) {
                    results[i].targetMonth = list[i].targetMonth;
                    results[i].expected = list[i].expected;
                }
            }

            // Chạy bộ lọc cước tháng bảo vệ danh sách
            results = filterResultsByMonth(results);

            // 1. Trả lời bảng kết quả chi tiết đúng chuẩn form gom nhóm mới của bạn
            const report = createReport(results);
            await waitMessage.edit(report);

            // 2. Tạo khối tin nhắn copy nhanh (chỉ chứa các tháng được chú ý và chưa đóng)
            const copyableLines = [];
            for (const r of results) {
                if (!r || r.error || r.paid || !Array.isArray(r.items)) continue;
                
                for (const item of r.items) {
                    if (!item || !item.date) continue;
                    const month = parseInt(item.date.split('-')[1], 10);
                    copyableLines.push(`${r.policy} (tháng${month}) ${money(item.amount || 0)}`);
                }
            }

            if (copyableLines.length > 0) {
                await message.channel.send(copyableLines.join('\n'));
            }

            // 3. Đưa vào hàng đợi giám sát tự động
            for (let i = 0; i < results.length; i++) {
                const r = results[i];
                if (!r || r.error) continue;

                if (!r.paid && Array.isArray(r.items)) {
                    monitoringMap.set(r.policy, {
                        expected: r.expected,
                        targetMonth: r.targetMonth,
                        unpaidItems: r.items.map(item => ({ date: item.date, amount: item.amount })),
                        channelId: message.channel.id
                    });
                } else {
                    monitoringMap.delete(r.policy);
                }
            }

        } catch (innerError) {
            console.error(innerError);
            await waitMessage.edit(`❌ Hệ thống Cathay phản hồi chậm hoặc lỗi: \`${innerError.message}\``);
        }
    } catch (globalError) { console.error(globalError); }
});

async function autoCheckSubscriptions() {
    if (monitoringMap.size === 0) return;
    const listToCheck = Array.from(monitoringMap.entries()).map(([policy, data]) => ({
        policy: policy, expected: data.expected, targetMonth: data.targetMonth
    }));
    try {
        const cathay = new CathayClient();
        await cathay.init();
        let results = await cathay.checkPolicies(listToCheck);
        
        for (let i = 0; i < results.length; i++) {
            if (results[i] && listToCheck[i]) {
                results[i].targetMonth = listToCheck[i].targetMonth;
                results[i].expected = listToCheck[i].expected;
            }
        }

        results = filterResultsByMonth(results);

        for (const r of results) {
            if (!r || r.error) continue;
            const savedData = monitoringMap.get(r.policy);
            if (!savedData) continue;
            const channel = await client.channels.fetch(savedData.channelId).catch(() => null);
            if (!channel) continue;

            if (r.paid) {
                for (const oldItem of savedData.unpaidItems) {
                    await channel.send(`🎉 **Mã ${r.policy}** (${money(oldItem.amount)}) đã thanh toán cước **tháng ${parseInt(oldItem.date.split('-')[1], 10)}**!`);
                }
                monitoringMap.delete(r.policy);
            } else {
                const currentUnpaidDates = Array.isArray(r.items) ? r.items.map(item => item.date) : [];
                for (const oldItem of savedData.unpaidItems) {
                    if (!currentUnpaidDates.includes(oldItem.date)) {
                        await channel.send(`🎉 **Mã ${r.policy}** (${money(oldItem.amount)}) đã thanh toán cước **tháng ${parseInt(oldItem.date.split('-')[1], 10)}**!`);
                    }
                }
                if (currentUnpaidDates.length === 0) monitoringMap.delete(r.policy);
                else {
                    savedData.unpaidItems = r.items.map(item => ({ date: item.date, amount: item.amount }));
                    monitoringMap.set(r.policy, savedData);
                }
            }
        }
    } catch (err) { console.error(err.message); }
}

if (process.env.DISCORD_TOKEN) {
    client.login(process.env.DISCORD_TOKEN).catch(err => console.error(err.message));
}