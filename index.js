require('dotenv').config();
const { Client, GatewayIntentBits } = require('discord.js');
const http = require('http');

const CathayClient = require("./src/CathayClient");
const { parsePolicies } = require("./src/parser");
const createReport = require("./src/report");

// BỘ NHỚ TẠM ĐỂ THEO DÕI HỢP ĐỒNG TRONG NGÀY
const monitoringMap = new Map();

function money(n) {
    return new Intl.NumberFormat("vi-VN").format(n) + "đ";
}

/**
 * Hàm bổ trợ: Nếu có cấu hình targetMonth, chỉ giữ lại kỳ cước của tháng đó
 * và tính toán lại toàn bộ thông số (tổng nợ, trạng thái khớp/lệch)
 */
function filterResultsByMonth(results, getTargetMonthFn) {
    for (const r of results) {
        if (r.error) continue;
        
        const targetM = getTargetMonthFn(r.policy);
        if (targetM != null) {
            // Lọc danh sách nợ từ hệ thống Cathay, chỉ giữ lại tháng trùng khớp
            r.items = r.items.filter(item => {
                const parts = item.date.split('-'); // Định dạng YYYY-MM-DD
                if (parts.length >= 2) {
                    return parseInt(parts[1], 10) === targetM;
                }
                return false;
            });
            
            // Tính toán lại các thông số sau khi lọc bỏ tháng thừa
            r.cathay = r.items.reduce((sum, item) => sum + item.amount, 0);
            r.paid = r.items.length === 0;
            
            if (r.expected != null) {
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

// Web server giữ mạng cho Render
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
    setInterval(autoCheckSubscriptions, 60 * 1000); // Vòng lặp 1 phút
});

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const list = parsePolicies(message.content);
    if (list.length === 0) return;

    await message.channel.sendTyping();
    const waitMessage = await message.reply("⏳ Phát hiện mã hợp đồng! Đang quét dữ liệu ban đầu, vui lòng đợi...");

    try {
        const cathay = new CathayClient();
        await cathay.init();
        let results = await cathay.checkPolicies(list);

        // ÁP DỤNG BỘ LỌC THÁNG CHO KẾT QUẢ ĐẦU VÀO
        results = filterResultsByMonth(results, (policy) => {
            const found = list.find(item => item.policy === policy);
            return found ? found.targetMonth : null;
        });

        const report = createReport(results);
        await waitMessage.edit(report);

        // LƯU TRẠNG THÁI VÀO BỘ NHỚ GIÁM SÁT NGẦM
        for (const r of results) {
            if (r.error) continue;

            const originalInput = list.find(item => item.policy === r.policy);
            const targetMonth = originalInput ? originalInput.targetMonth : null;

            if (!r.paid) {
                const unpaidItems = r.items.map(item => ({
                    date: item.date,
                    amount: item.amount
                }));
                
                monitoringMap.set(r.policy, {
                    expected: r.expected,
                    targetMonth: targetMonth, // Lưu kèm cấu hình tháng cần theo dõi
                    unpaidItems: unpaidItems,
                    channelId: message.channel.id
                });
                console.log(`[Giám sát] Đã thêm mã: ${r.policy} (Theo dõi tháng: ${targetMonth || 'Tất cả'})`);
            } else {
                monitoringMap.delete(r.policy);
            }
        }

    } catch (error) {
        console.error("Lỗi khi xử lý tin nhắn đầu vào:", error);
        await waitMessage.edit(`❌ Có lỗi xảy ra: \`${error.message}\``);
    }
});

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
        let results = await cathay.checkPolicies(listToCheck);

        // ÁP DỤNG BỘ LỌC THÁNG KHI QUÉT NGẦM
        results = filterResultsByMonth(results, (policy) => {
            const saved = monitoringMap.get(policy);
            return saved ? saved.targetMonth : null;
        });

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