function money(n) {
    return new Intl.NumberFormat("vi-VN").format(n) + "đ";
}

function createReport(results) {
    if (!results || !Array.isArray(results)) return "📋 Không có dữ liệu hiển thị.";
    
    let paid = 0;
    let unpaid = 0;
    let mismatch = 0;

    const lines = [];
    lines.push("📋 KẾT QUẢ KIỂM TRA");
    lines.push("");

    for (const r of results) {
        if (!r) continue;

        if (r.error) {
            lines.push(`❌ ${r.policy || "Mã ẩn"} - Lỗi: ${r.error}`);
            lines.push("");
            continue;
        }

        if (r.paid) {
            paid++;
            lines.push(`🟢 ${r.policy} - Đã thanh toán`);
            lines.push("");
        } else {
            unpaid++;
            if (r.expected != null && !r.match) {
                mismatch++;
            }

            const items = r.items || [];
            if (items.length === 1) {
                let line = `🔴 ${r.policy} - Cước còn: ${money(items[0].amount || 0)}`;
                
                if (r.expected != null) {
                    let matchText = "";
                    if (r.match) {
                        if (r.mode === "single") matchText = "✅ Khớp 1 kỳ";
                        else if (r.mode === "total") matchText = "✅ Khớp tổng";
                        else matchText = "✅ Khớp";
                    } else {
                        const sign = r.diff > 0 ? "+" : "";
                        matchText = `⚠ Sai lệch ${sign}${money(r.diff)}`;
                    }
                    line += ` | Ghi chú: ${money(r.expected)} (${matchText})`;
                }
                lines.push(line);
            } else if (items.length > 1) {
                lines.push(`🔴 ${r.policy} - Tổng cước còn: ${money(r.cathay || 0)}`);
                for (const item of items) {
                    if (item) lines.push(`  • ${item.date || 'Không rõ ngày'} : ${money(item.amount || 0)}`);
                }
                
                if (r.expected != null) {
                    let matchText = "";
                    if (r.match) {
                        if (r.mode === "single") matchText = "✅ Khớp 1 kỳ";
                        else if (r.mode === "total") matchText = "✅ Khớp tổng";
                        else matchText = "✅ Khớp";
                    } else {
                        const sign = r.diff > 0 ? "+" : "";
                        matchText = `⚠ Sai lệch ${sign}${money(r.diff)}`;
                    }
                    lines.push(`  [Ghi chú: ${money(r.expected)} | ${matchText}]`);
                }
            } else {
                lines.push(`🔴 ${r.policy} - Cước còn: 0đ`);
            }
            lines.push(""); 
        }
    }

    if (lines[lines.length - 1] === "") {
        lines.pop();
    }

    lines.push("──────────────");
    lines.push(`🟢 Đã thanh toán : ${paid}`);
    lines.push(`🔴 Chưa thanh toán : ${unpaid}`);
    lines.push(`⚠ Sai lệch : ${mismatch}`);

    return lines.join("\n");
}

module.exports = createReport;