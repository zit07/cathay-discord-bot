function parsePolicies(text) {
    if (!text) return [];
    const lines = text.split('\n');

    // Regex hỗ trợ cả 2 dạng mã:
    // 1. Chữ S + 11 chữ số (Ví dụ: S12345678901)
    // 2. 2 chữ số + 1 chữ cái + 9 chữ số (Ví dụ: 01M009146485)
    const POLICY_REGEX = /(?:S\d{11}|\d{2}[A-Za-z]\d{9})/i;

    // Gom nhóm các dòng theo từng mã (xử lý cả trường hợp số tiền nằm khác dòng với mã)
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

        // 1. Tìm tháng cần lọc (Ví dụ: tháng 6, tháng6, t6)
        let targetMonth = null;
        const monthMatch = combinedText.match(/(?:tháng|t)\s*(\d+)/i);
        if (monthMatch) {
            targetMonth = parseInt(monthMatch[1], 10);
        }

        // 2. Tách mã và cụm tháng ra khỏi chuỗi để lấy số tiền
        let textForAmount = combinedText.replace(POLICY_REGEX, '');
        textForAmount = textForAmount.replace(/(?:tháng|t)\s*(\d+)/i, '');

        // 3. Trích xuất số tiền (nhận diện cả số có dấu chấm như 11.385 hay kèm k, đ)
        const amountMatch = textForAmount.match(/(\d+[\d\.]*)\s*(k|đ|dđ)?(?=[^\d]*$)/i) || 
                            textForAmount.match(/(\d+[\d\.]*)\s*(k|đ|dđ)?/i);

        let expected = null;
        if (amountMatch) {
            let rawAmount = amountMatch[1].replace(/\./g, ''); // Bỏ dấu chấm phân cách (11.385 -> 11385)
            let num = parseFloat(rawAmount);

            const unit = amountMatch[2] ? amountMatch[2].toLowerCase() : '';

            // Tự động nhân 1000 cho số viết tắt/rút gọn (< 100.000 như 11.385 -> 11.385.000đ)
            if (unit === 'k' || num < 100000) {
                num = num * 1000;
            }
            expected = num;
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