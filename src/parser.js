function parsePolicies(text) {
    if (!text) return [];
    const lines = text.split('\n');
    const results = [];
    const seenKeys = new Set(); // Bộ lọc lưu các mã đã xử lý
    
    for (let line of lines) {
        line = line.trim();
        if (!line) continue;

        // 1. Tìm mã hợp đồng (chữ S và 11 chữ số)
        const policyMatch = line.match(/S\d{11}/i);
        if (!policyMatch) continue;
        const policy = policyMatch[0].toUpperCase();
        
        // 2. Tìm tháng cần lọc (Ví dụ: tháng6, tháng 6, t6)
        let targetMonth = null;
        const monthMatch = line.match(/tháng\s*(\d+)/i);
        if (monthMatch) {
            targetMonth = parseInt(monthMatch[1], 10);
        }
        
        // 3. Xóa mã hợp đồng và cụm "tháng X" ra khỏi chuỗi để tìm số tiền chính xác
        let textForAmount = line.replace(/S\d{11}/i, '');
        textForAmount = textForAmount.replace(/tháng\s*(\d+)/i, '');
        
        // Tìm số tiền còn lại (ưu tiên số ở cuối dòng hoặc số kèm chữ k, đ)
        const amountMatch = textForAmount.match(/(\d+[\d\.]*)\s*(k|đ|dđ)?(?=[^\d]*$)/i) || textForAmount.match(/(\d+[\d\.]*)\s*(k|đ|dđ)?/i);
        
        let expected = null;
        if (amountMatch) {
            let rawAmount = amountMatch[1].replace(/\./g, ''); // Xóa dấu chấm phân cách
            let num = parseFloat(rawAmount);
            
            const unit = amountMatch[2] ? amountMatch[2].toLowerCase() : '';
            // Tự động nhân 1000 nếu có chữ 'k' hoặc số viết tắt nhỏ hơn 10000
            if (unit === 'k' || num < 10000) {
                num = num * 1000;
            }
            expected = num;
        }

        // Khóa định danh kết hợp mã hợp đồng và tháng cần lọc
        const uniqueKey = `${policy}_${targetMonth || 'all'}`;

        // Chỉ thêm vào danh sách nếu chưa tồn tại
        if (!seenKeys.has(uniqueKey)) {
            seenKeys.add(uniqueKey);
            results.push({
                policy,
                expected,
                targetMonth
            });
        }
    }
    
    return results;
}

module.exports = { parsePolicies };