function parseMoney(line) {

    // Ưu tiên nếu có "=541k"
    let equal = line.match(/=\s*([\d.]+)\s*k?/i);

    if (equal) {
        return Number(equal[1].replace(/\./g, "")) * 1000;
    }

    // 367k + 174k
    let plus = line.match(/([\d.]+)\s*k?\s*\+\s*([\d.]+)\s*k?/i);

    if (plus) {

        const a = Number(plus[1].replace(/\./g, ""));
        const b = Number(plus[2].replace(/\./g, ""));

        return (a + b) * 1000;
    }

    // Tìm số đứng sau mã hợp đồng
    let policyLine = line.match(/S\d+\D+([\d.]+)\s*k?/i);

    if (policyLine) {

        return Number(policyLine[1].replace(/\./g, "")) * 1000;

    }

    return null;

}

function parsePolicies(text) {

    const lines = text
        .split(/\r?\n/)
        .map(x => x.trim())
        .filter(Boolean);

    const result = [];

    for (const line of lines) {

        const match = line.match(/S\d+/i);

        if (!match) continue;

        result.push({

            policy: match[0].toUpperCase(),

            expected: parseMoney(line)

        });

    }

    return result;

}

module.exports = {
    parsePolicies
};