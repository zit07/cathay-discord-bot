function money(n) {
    return new Intl.NumberFormat("vi-VN").format(n) + "đ";
}

function createReport(results) {
    if (!results || !Array.isArray(results)) return "📋 Không có dữ liệu hiển thị.";
    
    let paidCount = 0;
    let unpaidCount = 0;
    let mismatchCount = 0;

    const paidLines = [];
    const unpaidLines = [];
    const errorLines = [];

    // Phân loại dữ liệu vào các nhóm riêng biệt
    for (const r of results) {
        if (!r) continue;

        if (r.error) {
            errorLines.push(`❌ ${r.policy || "Mã ẩn"} - Lỗi: ${r.error}`);
            continue;
        }

        if (r.paid) {
            paidCount++;
            paidLines.push(`🟢 ${r.policy} - Đã thanh toán`);
        } else {
            unpaidCount++;
            if (r.expected != null && !r.match) {
                mismatchCount++;
            }

            const items = r.items || [];
            let line = "";
            
            if (items.length === 1) {
                line = `🔴 ${r.policy} - Cước còn: ${money(items[0].amount || 0)}`;
            } else if (items.length > 1) {
                line = `🔴 ${r.policy} - Tổng cước còn: ${money(r.cathay || 0)}`;
                for (const item of items) {
                    if (item) line += `\n  • ${item.date || 'Không rõ ngày'} : ${money(item.amount || 0)}`;
                }
            } else {
                line = `🔴 ${r.policy} - Cước còn: 0đ`;
            }

            // Nếu xảy ra sai lệch cước so với ghi chú thì đính kèm cảnh báo vào dòng đó
            if (r.expected != null && !r.match) {
                const sign = r.diff > 0 ? "+" : "";
                line += ` | Ghi chú: ${money(r.expected)} (⚠ Sai lệch ${sign}${money(r.diff)})`;
            }
            
            unpaidLines.push(line);
        }
    }

    // Tiến hành dựng cấu trúc văn bản theo đúng Form mẫu yêu cầu
    const lines = [];
    lines.push("📋 KẾT QUẢ KIỂM TRA");
    lines.push("");

    // Hiện lỗi lên đầu nếu có
    if (errorLines.length > 0) {
        for (const err of errorLines) lines.push(err);
        lines.push("");
    }

    // Nhóm 1: Gom toàn bộ các mã Đã thanh toán (🟢) liền nhau
    if (paidLines.length > 0) {
        for (const p of paidLines) lines.push(p);
    }

    // Nhóm 2: Gom các mã Chưa thanh toán (🔴) và tạo khoảng trống phân cách từng mã
    if (unpaidLines.length > 0) {
        if (paidLines.length > 0) {
            lines.push(""); // Dòng trống ngăn cách giữa cụm xanh và cụm đỏ
        }
        for (const u of unpaidLines) {
            lines.push(u);
            lines.push(""); // Dòng trống sau mỗi khối đơn chưa thanh toán
        }
        lines.pop(); // Xóa dòng trống thừa cuối cùng trước khi kẻ ngang
    }

    lines.push("──────────────");
    lines.push(`🟢 Đã thanh toán : ${paidCount}`);
    lines.push(`🔴 Chưa thanh toán : ${unpaidCount}`);
    lines.push(`⚠ Sai lệch : ${mismatchCount}`);

    return lines.join("\n");
}

module.exports = createReport;