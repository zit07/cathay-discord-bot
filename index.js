require('dotenv').config();

// FIX LỖI TREO KẾT NỐI TRÊN RENDER: Ưu tiên IPv4 thay vì IPv6
const dns = require('dns');
if (dns.setDefaultResultOrder) {
    dns.setDefaultResultOrder('ipv4first');
}

const { Client, GatewayIntentBits } = require('discord.js');
const http = require('http');
const { Redis } = require('@upstash/redis');

const CathayClient = require("./src/CathayClient");
const { parsePolicies } = require("./src/parser");
const createReport = require("./src/report");

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

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
        
        let filteredItems = Array.isArray(r.items) ? [...r.items] : [];

        if (r.targetMonth != null && filteredItems.length > 0) {
            filteredItems = filteredItems.filter(item => {
                if (!item || !item.date) return false;
                const parts = item.date.split('-');
                if (parts.length >= 2) {
                    return parseInt(parts[1], 10) === r.targetMonth;
                }
                return false;
            });
        }
        
        r.items = filteredItems;
        r.cathay = r.items.reduce((sum, item) => sum + (item.amount || 0), 0);

        // BẢO VỆ: Chỉ xác nhận Đã thanh toán khi Cathay báo 1005 (isOfficialPaid) 
        // hoặc khi không lọc theo tháng và danh sách cước thực sự rỗng.
        if (r.isOfficialPaid) {
            r.paid = true;
        } else if (r.targetMonth == null && r.items.length === 0) {
            r.paid = true;
        } else {
            r.paid = false;
        }
        
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

// Bắt lỗi kết nối Gateway ngầm
client.on('error', (err) => console.error('❌ [LỖI CLIENT]:', err.message));
client.on('shardError', (error) => console.error('❌ [LỖI GATEWAY WEBSOCKET]:', error.message));

// Sử dụng sự kiện 'ready' chuẩn của discord.js
client.once('ready', (c) => {
    console.log(`🟢 Bot Cathay đã online thành công với tên: ${c.user.tag}`);
    
    // Giãn thời gian quét ngầm thành 5 phút (5 * 60 * 1000)
    if (!client.autoCheckInterval) {
        client.autoCheckInterval = setInterval(autoCheckSubscriptions, 5 * 60 * 1000);
    }
});

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
                    copyableLines.push(`${r.policy} (tháng${month})${money(item.amount || 0)}`);
                }
            }

            if (copyableLines.length > 0) {
                await message.channel.send(copyableLines.join('\n'));
            }

            // Lưu danh sách theo dõi vào Cloud Redis
            for (const r of results) {
                if (!r || r.error) continue;

                if (!r.paid && Array.isArray(r.items) && r.items.length > 0) {
                    await dbHelper.set(r.policy, {
                        expected: r.expected,
                        targetMonth: r.targetMonth,
                        unpaidItems: r.items.map(item => ({ date: item.date, amount: item.amount })),
                        channelId: message.channel.id
                    });
                } else if (r.paid) {
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
    const savedList = await dbHelper.getAll();
    if (savedList.length === 0) return;

    const listToCheck = savedList.map(data => ({
        policy: data.policy, 
        expected: data.expected
    }));

    try {
        const cathay = new CathayClient();
        await cathay.init();
        let results = await cathay.checkPolicies(listToCheck);

        for (const r of results) {
            if (!r || r.error) {
                console.log(`[Auto-Check] Bỏ qua mã ${r?.policy || 'unknown'} do lỗi API: ${r?.error}`);
                continue;
            }

            const savedData = await dbHelper.get(r.policy);
            if (!savedData) continue;

            const channel = await client.channels.fetch(savedData.channelId).catch(() => null);
            if (!channel) continue;

            const currentUnpaidDates = Array.isArray(r.items) ? r.items.map(item => item.date) : [];
            const remainingUnpaidItems = [];

            for (const oldItem of savedData.unpaidItems) {
                if (r.isOfficialPaid || !currentUnpaidDates.includes(oldItem.date)) {
                    const month = parseInt(oldItem.date.split('-')[1], 10);
                    await channel.send(`🎉 **Mã ${r.policy}** (${money(oldItem.amount)}) đã thanh toán cước **tháng ${month}**!`);
                } else {
                    remainingUnpaidItems.push(oldItem);
                }
            }

            if (remainingUnpaidItems.length === 0 || r.isOfficialPaid) {
                await dbHelper.delete(r.policy);
            } else {
                savedData.unpaidItems = remainingUnpaidItems;
                await dbHelper.set(r.policy, savedData);
            }
        }
    } catch (err) { 
        console.error("[Auto-Check] Lỗi quét ngầm:", err.message); 
    }
}


// 1. Đăng ký sự kiện Ready TRƯỚC KHI gọi login (hỗ trợ cả chuẩn cũ lẫn v15)
const handleOnline = () => {
    console.log(`🟢 Bot Cathay đã online thành công với tên: ${client.user?.tag}`);
};

client.once("ready", handleOnline);
client.once("clientReady", handleOnline);

// 2. Lấy Token và tự động lọc bỏ khoảng trắng / dấu ngoặc kép thừa
const rawToken = process.env.DISCORD_TOKEN;
const TOKEN = rawToken ? rawToken.trim().replace(/^["']|["']$/g, '') : null;

if (!TOKEN) {
    console.error("❌ [LỖI] DISCORD_TOKEN đang bị thiếu trên Render! Hãy kiểm tra tab Environment.");
} else {
    console.log(`⏳ Đang kết nối tới Discord Gateway (Token length: ${TOKEN.length})...`);
    client.login(TOKEN).catch((err) => {
        console.error("❌ [LỖI ĐĂNG NHẬP DISCORD]:", err.message);
    });
}