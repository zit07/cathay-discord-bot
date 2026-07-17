const axios = require("axios");
const { wrapper } = require("axios-cookiejar-support");
const { CookieJar } = require("tough-cookie");

class CathayClient {
    constructor() {
        this.jar = new CookieJar();

        this.client = wrapper(
            axios.create({
                jar: this.jar,
                withCredentials: true,
                headers: {
                    "User-Agent":
                        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/150 Safari/537.36"
                }
            })
        );
    }

    async init() {
        console.log("Đang lấy cookie...");

        const res = await this.client.get(
            "https://www.cathaylife.com.vn/CPWeb/html/MO/A1/MOA1_0100/MOA10000.html"
        );

        console.log("HTTP:", res.status);

        const cookies = await this.jar.getCookies(
            "https://www.cathaylife.com.vn"
        );

        console.log("Cookies:");

        for (const c of cookies) {
            console.log(`- ${c.key} = ${c.value}`);
        }
    }

    async checkPolicy(policyNo) {

        const body = new URLSearchParams({
            polNum: policyNo,
            "g-recaptcha-response": ""
        });

        const response = await this.client.post(
            "https://www.cathaylife.com.vn/CPWeb/servlet/HttpDispatcher/CPZL_0100/getPremiums",
            body.toString(),
            {
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                    "Accept": "application/json, text/javascript, */*; q=0.01",
                    "Origin": "https://www.cathaylife.com.vn",
                    "Referer": "https://www.cathaylife.com.vn/CPWeb/html/MO/A1/MOA1_0100/MOA10000.html",
                    "X-Requested-With": "XMLHttpRequest"
                }
            }
        );

        return response.data;
    }

        parseResult(data) {

            if (data.rtnCode === 1005) {
                return {
                    paid: true,
                    total: 0,
                    items: []
                };
            }

            const premiums = (data.rtnList || [])
                .filter(x => x.FEE_TYPE === "2")
                .map(x => ({
                    date: x.OUGHT_PAY_DATE,
                    amount: Number(x.PREM)
                }));

            return {
                paid: false,
                total: premiums.reduce((s, p) => s + p.amount, 0),
                items: premiums
            };

        }

        compareAmount(expected, parsed) {

            if (parsed.paid) {
                return {
                    match: true,
                    diff: 0,
                    mode: "paid"
                };
            }

            if (expected == null) {
                return {
                    match: null,
                    diff: 0,
                    mode: "unknown"
                };
            }

            // Khớp với từng kỳ
            for (const item of parsed.items) {
                if (item.amount === expected) {
                    return {
                        match: true,
                        diff: 0,
                        mode: "single"
                    };
                }
            }

            // Khớp tổng nhiều kỳ
            if (parsed.total === expected) {
                return {
                    match: true,
                    diff: 0,
                    mode: "total"
                };
            }

            return {
                match: false,
                diff: parsed.total - expected,
                mode: "mismatch"
            };

        }

    async checkPolicies(policyList) {

        const results = [];

        for (const item of policyList) {

            try {

                const raw = await this.checkPolicy(item.policy);

                const parsed = this.parseResult(raw);

                const compare = this.compareAmount(item.expected, parsed);

                results.push({

                    policy: item.policy,

                    expected: item.expected,

                    paid: parsed.paid,

                    cathay: parsed.total,

                    items: parsed.items,

                    match: compare.match,

                    diff: compare.diff,

                    mode: compare.mode

                });

            } catch (err) {

                results.push({

                    policy: item.policy,

                    error: err.message

                });

            }

        }

        return results;

    }
}

module.exports = CathayClient;
