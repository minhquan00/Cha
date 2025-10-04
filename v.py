
import requests
import concurrent.futures
import os
import cloudscraper
import threading
import hashlib
from urllib.parse import urlparse

# Danh sách API HTTP proxy (VIP + Free, tập trung elite/anonymous)
APIS_HTTP = [
    # Proxyscrape (elite proxies)
    "https://api.proxyscrape.com/v4/free-proxy-list/get?request=display_proxies&protocol=http&proxy_format=ipport&format=text&timeout=1000&anonymity=elite",
    # Open Proxy Space
    "https://openproxy.space/list/http",
    # Geonode (lọc elite, cập nhật nhanh)
    "https://proxylist.geonode.com/api/proxy-list?limit=500&page=1&sort_by=lastChecked&sort_type=desc&protocols=http&anonymityLevel=elite",
    # Proxy-List.download
    "https://www.proxy-list.download/api/v1/get?type=http&anon=elite",
    # VSIS.net (Việt Nam, ưu tiên tốc độ)
    "http://36.50.134.20:3000/download/vn.txt",
]

OUT_FILE = "http_vip.txt"
lock = threading.Lock()

# Biến toàn cục để đếm số proxy đã check
checked_count = 0
checked_lock = threading.Lock()

# Hàm kiểm tra tính duy nhất của proxy
def hash_proxy(proxy):
    return hashlib.md5(proxy.encode()).hexdigest()

# B1: Check proxy sống (httpbin.org, timeout thấp hơn)
def check_alive(proxy):
    global checked_count
    test_url = "https://httpbin.org/ip"
    proxies = {"http": f"http://{proxy}", "https": f"http://{proxy}"}
    try:
        r = requests.get(test_url, proxies=proxies, timeout=1.5)  # Giảm timeout
        if r.status_code == 200:
            with checked_lock:
                checked_count += 1
                print(f"🔍 Đã check {checked_count} proxy sống", end="\r")
            return proxy
        return None
    except:
        with checked_lock:
            checked_count += 1
            print(f"🔍 Đã check {checked_count} proxy sống", end="\r")
        return None

# B2: Check qua Cloudflare (cdn-cgi/trace) + lưu dạng IP:Port
def check_cloudflare(proxy):
    global checked_count
    test_url = "https://www.cloudflare.com/cdn-cgi/trace"
    proxies = {"http": f"http://{proxy}", "https": f"http://{proxy}"}
    try:
        scraper = cloudscraper.create_scraper()
        r = scraper.get(test_url, proxies=proxies, timeout=3)  # Giảm timeout
        if r.status_code == 200:
            with lock:
                with open(OUT_FILE, "a") as f:
                    f.write(f"{proxy}\n")  # Chỉ lưu IP:Port
                print(f"✅ Lưu proxy: {proxy}")
            with checked_lock:
                checked_count += 1
                print(f"🌐 Đã check {checked_count} proxy Cloudflare", end="\r")
            return proxy
        return None
    except:
        with checked_lock:
            checked_count += 1
            print(f"🌐 Đã check {checked_count} proxy Cloudflare", end="\r")
        return None

# Lấy proxy từ API
def fetch_api(url):
    proxies = set()  # Dùng set để tránh trùng
    try:
        if "geonode.com" in url:
            r = requests.get(url, timeout=8).json()
            for p in r.get("data", []):
                ip, port = p.get("ip"), p.get("port")
                if ip and port:
                    proxy = f"{ip}:{port}"
                    if hash_proxy(proxy) not in proxies:
                        proxies.add(proxy)
        else:
            r = requests.get(url, timeout=8)
            for line in r.text.splitlines():
                if ":" in line:
                    proxy = line.strip()
                    if hash_proxy(proxy) not in proxies:
                        proxies.add(proxy)
    except Exception as e:
        print(f"⚠️ Lỗi khi lấy từ {urlparse(url).netloc}: {e}")
    return list(proxies)

def main():
    global checked_count
    
    # Xoá file cũ
    if os.path.exists(OUT_FILE):
        os.remove(OUT_FILE)
        print(f"🗑️ Đã xoá file cũ: {OUT_FILE}")

    # Tải proxy
    all_proxies = []
    print("🌐 Đang đào HTTP proxy siêu VIP...")
    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
        results = executor.map(fetch_api, APIS_HTTP)
        for proxies in results:
            all_proxies.extend(proxies)

    all_proxies = list(set(all_proxies))  # Lọc trùng lần nữa
    print(f"🔍 Tổng proxy HTTP lấy được: {len(all_proxies)}")

    # B1: Check proxy sống
    print("⚡ Đang check proxy sống...")
    checked_count = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=150) as executor:
        alive_results = list(executor.map(check_alive, all_proxies))
    print()
    alive = [p for p in alive_results if p]
    print(f"✅ Proxy sống: {len(alive)}/{len(all_proxies)}")

    # B2: Check Cloudflare + lưu ngay
    print("🌐 Đang check proxy qua Cloudflare...")
    checked_count = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=150) as executor:
        list(executor.map(check_cloudflare, alive))
    print()

    # Báo cáo cuối
    with open(OUT_FILE, "r") as f:
        saved = f.read().splitlines()
    print(f"\n🎯 Hoàn tất: {len(saved)} proxy siêu VIP vượt Cloudflare đã lưu vào {OUT_FILE}")

if __name__ == "__main__":
    main()