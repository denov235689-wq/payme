/**
 * PayHamyon Payment Gateway - Node.js SDK
 */

const https = require('https');
const http = require('http');

const SHOP_ID = 1;
const SHOP_KEY = "UXWVBIiIr1NeK7ihrI9Rlyz5G1IBbpMG";
const BASE_URL = "https://user91.hostx.uz";

function getShopInfo(shopId = SHOP_ID, shopKey = SHOP_KEY, baseUrl = BASE_URL) {
    return sendRequest(`${baseUrl}/api/shop/info`, {
        shop_id: Number(shopId),
        shop_key: String(shopKey).trim(),
    });
}

function createPayment(amount, callbackUrl = null, shopId = SHOP_ID, shopKey = SHOP_KEY, baseUrl = BASE_URL) {
    const payload = {
        shop_id: Number(shopId),
        shop_key: String(shopKey).trim(),
        amount: Number(amount),
    };
    if (callbackUrl) {
        payload.callback_url = String(callbackUrl).trim();
    }
    return sendRequest(`${baseUrl}/api/payment/create`, payload);
}

function checkPayment(token, shopId = SHOP_ID, shopKey = SHOP_KEY, baseUrl = BASE_URL) {
    return sendRequest(`${baseUrl}/api/payment/check`, {
        shop_id: Number(shopId),
        shop_key: String(shopKey).trim(),
        token: String(token).trim(),
    });
}

function cancelPayment(token, shopId = SHOP_ID, shopKey = SHOP_KEY, baseUrl = BASE_URL) {
    return sendRequest(`${baseUrl}/api/payment/cancel`, {
        shop_id: Number(shopId),
        shop_key: String(shopKey).trim(),
        token: String(token).trim(),
    });
}

function sendRequest(url, payload) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        const postData = JSON.stringify(payload);
        const client = urlObj.protocol === 'https:' ? https : http;

        const options = {
            hostname: urlObj.hostname,
            port: urlObj.port || (urlObj.protocol === 'https:' ? 443 : 80),
            path: urlObj.pathname,
            method: 'POST',
            timeout: 15000,
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'Accept': 'application/json',
                'Content-Length': Buffer.byteLength(postData),
            },
        };

        const req = client.request(options, (res) => {
            let responseBody = '';
            res.on('data', (chunk) => { responseBody += chunk; });
            res.on('end', () => {
                try {
                    resolve(JSON.parse(responseBody));
                } catch (e) {
                    resolve({ success: false, error: 'invalid_json', raw: responseBody });
                }
            });
        });

        req.on('error', (err) => { reject(err); });
        req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
        req.write(postData);
        req.end();
    });
}

module.exports = {
    getShopInfo,
    createPayment,
    checkPayment,
    cancelPayment,
};
