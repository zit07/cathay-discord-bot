require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const http = require('http');
const { Redis } = require('@upstash/redis');

const CathayClient = require("./src/CathayClient");
const { parsePolicies } = require("./src/parser");
const createReport = require("./src/report");

// 1. Khởi tạo kết nối Redis từ biến môi trường của Render
const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// Bộ công cụ thao tác dữ liệu Cloud thay thế Map
const dbHelper = {
    async set(policy, data) {
        await redis.hset('cathay_monitoring', { [policy]: JSON.stringify(data) });
    },
    async delete(policy) {
        await redis.hdel('cathay_monitoring', policy);
    },
    async get(policy) {
        const raw = await redis.hget('cathay_monitoring', policy);
        if (!raw) return null;
        return typeof raw === 'string' ? JSON.parse(raw) : raw;
    },
    async getAll() {
        const raw = await redis.hgetall('cathay_monitoring');
        if (!raw) return [];
        return Object.entries(raw).map(([policy, data]) => {
            const parsed = typeof data === 'string' ? JSON.parse(data) : data;
            return { policy, ...parsed };
        });
    }
};

function money(n) {
    return new Intl.NumberFormat("vi-VN").format(n) + "đ";
}

function filterResultsByMonth(results) {
    if (!results || !Array.isArray(results)) return [];
    
    for (const r of results) {
        if (!r || r.error) continue;
        
        if (r.targetMonth != null && Array.isArray(r.items)) {
            r.items = r.items.filter(item => {
                if (!item || !item.date) return false;
                const parts = item.date.split('-');
                if (parts.length >= 2) {
                    return parseInt(parts[1], 10) === r.targetMonth;
                }
                return false;
            });
        }
        
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

            for (const r of results) {
                if (!r) continue;
                const inputItem = list.find(item => item.policy === r.policy);
                if (inputItem) {
                    r.targetMonth = inputItem.targetMonth;
                    r.expected = inputItem.expected;
                }
            }

            results = filterResultsByMonth(results);

            const report = createReport(results);
            await waitMessage.edit(report);

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

            // Lưu danh sách theo dõi vào Cloud Redis
            for (const r of results) {
                if (!r || r.error) continue;

                if (!r.paid && Array.isArray(r.items)) {
                    await dbHelper.set(r.policy, {
                        expected: r.expected,
                        targetMonth: r.targetMonth,
                        unpaidItems: r.items.map(item => ({ date: item.date, amount: item.amount })),
                        channelId: message.channel.id
                    });
                } else {
                    await dbHelper.delete(r.policy);
                }
            }

        } catch (innerError) {
            console.error(innerError);
            await waitMessage.edit(`❌ Hệ thống Cathay phản hồi chậm hoặc lỗi: \`${innerError.message}\``);
        }
    } catch (globalError) { console.error(globalError); }
});

async function autoCheckSubscriptions() {
    // Lấy danh sách hợp đồng cần quét từ Cloud Redis
    const savedList = await dbHelper.getAll();
    if (savedList.length === 0) return;

    const listToCheck = savedList.map(data => ({
        policy: data.policy, 
        expected: data.expected, 
        targetMonth: data.targetMonth
    }));

    try {
        const cathay = new CathayClient();
        await cathay.init();
        let results = await cathay.checkPolicies(listToCheck);

        for (const r of results) {
            if (!r || r.error) continue;
            const savedData = await dbHelper.get(r.policy);
            if (savedData) {
                r.targetMonth = savedData.targetMonth;
                r.expected = savedData.expected;
            }
        }

        results = filterResultsByMonth(results);

        for (const r of results) {
            if (!r || r.error) continue;
            const savedData = await dbHelper.get(r.policy);
            if (!savedData) continue;

            const channel = await client.channels.fetch(savedData.channelId).catch(() => null);
            if (!channel) continue;

            if (r.paid) {
                for (const oldItem of savedData.unpaidItems) {
                    const month = parseInt(oldItem.date.split('-')[1], 10);
                    await channel.send(`🎉 **Mã ${r.policy}** (${money(oldItem.amount)}) đã thanh toán cước **tháng ${month}**!`);
                }
                await dbHelper.delete(r.policy);
            } else {
                const currentUnpaidDates = Array.isArray(r.items) ? r.items.map(item => item.date) : [];
                
                for (const oldItem of savedData.unpaidItems) {
                    if (!currentUnpaidDates.includes(oldItem.date)) {
                        const month = parseInt(oldItem.date.split('-')[1], 10);
                        await channel.send(`🎉 **Mã ${r.policy}** (${money(oldItem.amount)}) đã thanh toán cước **tháng ${month}**!`);
                    }
                }

                if (currentUnpaidDates.length === 0) {
                    await dbHelper.delete(r.policy);
                } else {
                    savedData.unpaidItems = r.items.map(item => ({ date: item.date, amount: item.amount }));
                    await dbHelper.set(r.policy, savedData);
                }
            }
        }
    } catch (err) { 
        console.error("[Auto-Check] Lỗi quét ngầm:", err.message); 
    }
}

if (process.env.DISCORD_TOKEN) {
    client.login(process.env.DISCORD_TOKEN).catch(err => console.error(err.message));
}