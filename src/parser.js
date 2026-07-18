function parsePolicies(text) {
    if (!text) return [];
    const lines = text.split('\n');
    const results = [];
    
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
            let rawAmount = amountMatch[1].replace(/\./g, ''); // Xóa dấu chấm phân cách (2.384 -> 2384)
            let num = parseFloat(rawAmount);
            
            const unit = amountMatch[2] ? amountMatch[2].toLowerCase() : '';
            // Tự động nhân 1000 nếu có chữ 'k' hoặc số viết tắt nhỏ hơn 10000 (1497 -> 1.497.000)
            if (unit === 'k' || num < 10000) {
                num = num * 1000;
            }
            expected = num;
        }
        
        results.push({
            policy,
            expected,
            targetMonth // Trả thêm thông tin tháng cần lọc
        });
    }
    
    return results;
}

module.exports = { parsePolicies };