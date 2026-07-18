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
 * Bộ lọc cước theo tháng dựa trên STT hoặc tên mã
 */
function filterResultsByMonth(results, list) {
    if (!results || !Array.isArray(results)) return [];
    
    for (let i = 0; i < results.length; i++) {
        const r = results[i];
        if (!r || r.error) continue;
        
        let inputItem = list[i];
        if (!inputItem || inputItem.policy !== r.policy) {
            inputItem = list.find(item => item.policy === r.policy);
        }
        
        const targetM = inputItem ? inputItem.targetMonth : null;
        
        if (targetM != null && Array.isArray(r.items)) {
            r.items = r.items.filter(item => {
                if (!item || !item.date) return false;
                const parts = item.date.split('-');
                if (parts.length >= 2) {
                    return parseInt(parts[1], 10) === targetM;
                }
                return false;
            });
            
            r.cathay = r.items.reduce((sum, item) => sum + (item.amount || 0), 0);
            r.paid = r.items.length === 0;
            
            if (inputItem && inputItem.expected != null) {
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

// Khởi tạo Web Server giữ mạng Render
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.write("Bot Cathay đang chạy và giám sát 24/7!");
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

// SỬA LỖI DEPRECATION: Hỗ trợ cả 'ready' và 'clientReady' tùy theo phiên bản của thư viện
const handleReady = (c) => {
    const botTag = c?.user?.tag || client?.user?.tag || "Bot Cathay";
    console.log(`🤖 Bot Cathay đã online thành công với tên: ${botTag}`);
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

            results = filterResultsByMonth(results, list);

            // 1. Trả lời bảng kết quả chi tiết (Giao diện đầy đủ)
            const report = createReport(results);
            await waitMessage.edit(report);

            // 2. Tạo khối tin nhắn copy nhanh (Không kèm chữ đ)
            const copyableLines = [];
            for (const r of results) {
                if (!r || r.error || r.paid || !Array.isArray(r.items)) continue;
                
                for (const item of r.items) {
                    if (!item || !item.date) continue;
                    const month = parseInt(item.date.split('-')[1], 10);
                    const amountStr = money(item.amount || 0).replace(/đ/g, '');
                    copyableLines.push(`${r.policy} (tháng${month}) ${amountStr}`);
                }
            }

            if (copyableLines.length > 0) {
                await message.channel.send(copyableLines.join('\n'));
            }

            // 3. Đưa vào hàng đợi quét ngầm
            for (let i = 0; i < results.length; i++) {
                const r = results[i];
                if (!r || r.error) continue;

                let inputItem = list[i] || list.find(item => item.policy === r.policy);
                const targetMonth = inputItem ? inputItem.targetMonth : null;

                if (!r.paid && Array.isArray(r.items)) {
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

        } catch (innerError) {
            console.error("Lỗi hệ thống Cathay:", innerError);
            await waitMessage.edit(`❌ Hệ thống Cathay phản hồi chậm hoặc lỗi: \`${innerError.message}\``);
        }

    } catch (globalError) {
        console.error("Lỗi xử lý tin nhắn:", globalError);
    }
});

async function autoCheckSubscriptions() {
    if (monitoringMap.size === 0) return;

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
            if (!r || r.error) continue;

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
                const currentUnpaidDates = Array.isArray(r.items) ? r.items.map(item => item.date) : [];

                for (const oldItem of savedData.unpaidItems) {
                    if (!currentUnpaidDates.includes(oldItem.date)) {
                        const month = parseInt(oldItem.date.split('-')[1], 10);
                        await channel.send(`🎉 **Mã ${r.policy}** (${money(oldItem.amount)}) đã thanh toán cước **tháng ${month}**!`);
                    }
                }

                const currentUnpaidItems = Array.isArray(r.items) ? r.items.map(item => ({
                    date: item.date,
                    amount: item.amount
                })) : [];

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

// Ghi log để theo dõi chính xác thời điểm gửi yêu cầu đăng nhập
console.log("🔌 Đang kết nối tới Discord Gateway...");
client.login(process.env.DISCORD_TOKEN).catch(err => {
    console.error("❌ Không thể đăng nhập vào Discord. Nguyên nhân:", err.message);
});