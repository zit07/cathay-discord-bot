function parsePolicies(text) {
    if (!text) return [];
    const lines = text.split('\n');

    // Regex hỗ trợ nhận diện mã hóa đơn:
    // 1. Chữ S + 11 chữ số (Ví dụ: S12345678901)
    // 2. 2 chữ số + 1 chữ cái + 9 chữ số (Ví dụ: 01M009146485)
    const POLICY_REGEX = /(?:S\d{11}|\d{2}[A-Za-z]\d{9})/i;

    // Gom nhóm các dòng theo từng mã hóa đơn
    const blocks = [];
    let currentBlock = null;

    for (let line of lines) {
        line = line.trim();
        if (!line) continue;

        const policyMatch = line.match(POLICY_REGEX);
        if (policyMatch) {
            if (currentBlock) {
                blocks.push(currentBlock);
            }
            currentBlock = {
                policy: policyMatch[0].toUpperCase(),
                lines: [line]
            };
        } else if (currentBlock) {
            currentBlock.lines.push(line);
        }
    }
    if (currentBlock) {
        blocks.push(currentBlock);
    }

    const results = [];

    for (const block of blocks) {
        const policy = block.policy;
        const combinedText = block.lines.join(' ');

        // Tách mã hóa đơn ra khỏi chuỗi
        let textWithoutPolicy = combinedText.replace(POLICY_REGEX, '');

        // Loại bỏ các cụm nhân số lượng (ví dụ: "x 2", "x2") để tránh nhầm lẫn số nhỏ với tháng
        textWithoutPolicy = textWithoutPolicy.replace(/x\s*\d+/gi, '');

        // Trích xuất tất cả các con số xuất hiện trong văn bản (hỗ trợ cả dấu chấm phân cách như 1.508.000)
        const numberMatches = [...textWithoutPolicy.matchAll(/(\d+[\d\.]*)\s*(k|đ|dđ)?/gi)];

        let expected = null;
        const monthsFound = [];

        for (const match of numberMatches) {
            const rawNumStr = match[1];
            const unit = match[2] ? match[2].toLowerCase() : '';
            const cleanNumStr = rawNumStr.replace(/\./g, '');
            const num = parseFloat(cleanNumStr);

            if (isNaN(num)) continue;

            // Áp dụng quy tắc của bạn:
            // 1. Số > 12 hoặc có đơn vị 'k', 'đ' là SỐ TIỀN
            if (unit === 'k' || num > 12) {
                let finalAmount = num;
                if (unit === 'k' || finalAmount < 100000) {
                    finalAmount = finalAmount * 1000;
                }
                expected = finalAmount;
            } 
            // 2. Số từ 1 đến 12 là SỐ THÁNG
            else if (num >= 1 && num <= 12) {
                if (!monthsFound.includes(num)) {
                    monthsFound.push(num);
                }
            }
        }

        // Xử lý targetMonth: nếu có 1 tháng trả về số, nhiều tháng trả về mảng
        let targetMonth = null;
        if (monthsFound.length === 1) {
            targetMonth = monthsFound[0];
        } else if (monthsFound.length > 1) {
            targetMonth = monthsFound;
        }

        results.push({
            policy,
            expected,
            targetMonth
        });
    }

    return results;
}

module.exports = { parsePolicies };