// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicIsize, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Runtime};

/* ══════════════ 动态图标：把当前时间画成「上面两个数、下面两个数」 ══════════════ */

static IS_24H: AtomicBool = AtomicBool::new(true);

#[repr(C)]
#[derive(Default)]
struct SystemTime {
    year: u16,
    month: u16,
    day_of_week: u16,
    day: u16,
    hour: u16,
    minute: u16,
    second: u16,
    milliseconds: u16,
}

#[link(name = "kernel32")]
extern "system" {
    fn GetLocalTime(t: *mut SystemTime);
}

const SM_CXSMICON: i32 = 49;
const SM_CXICON: i32 = 11;
const WM_SETICON: u32 = 0x0080;
const ICON_SMALL: usize = 0;
const ICON_BIG: usize = 1;

#[link(name = "user32")]
extern "system" {
    fn GetSystemMetrics(index: i32) -> i32;
    // 自己造 HICON 直接塞给窗口：tao 只设 ICON_SMALL，而 Win11 任务栏按钮看的是 ICON_BIG
    fn CreateIconFromResourceEx(
        presbits: *const u8,
        dwreslen: u32,
        ficon: i32,
        dwver: u32,
        cx: i32,
        cy: i32,
        flags: u32,
    ) -> isize;
    fn SendMessageW(hwnd: isize, msg: u32, wparam: usize, lparam: isize) -> isize;
    fn DestroyIcon(icon: isize) -> i32;
}

fn local_now() -> SystemTime {
    let mut t = SystemTime::default();
    unsafe { GetLocalTime(&mut t) };
    t
}

// 3×5 点阵数字，每行 3 位（高位在左）
const FONT: [[u8; 5]; 10] = [
    [0b111, 0b101, 0b101, 0b101, 0b111], // 0
    [0b010, 0b110, 0b010, 0b010, 0b111], // 1
    [0b111, 0b001, 0b111, 0b100, 0b111], // 2
    [0b111, 0b001, 0b111, 0b001, 0b111], // 3
    [0b101, 0b101, 0b111, 0b001, 0b001], // 4
    [0b111, 0b100, 0b111, 0b001, 0b111], // 5
    [0b111, 0b100, 0b111, 0b101, 0b111], // 6
    [0b111, 0b001, 0b010, 0b100, 0b100], // 7（斜腿：横杠之后笔画像左下走，用户自己设计的）
    [0b111, 0b101, 0b111, 0b101, 0b111], // 8
    [0b111, 0b101, 0b111, 0b001, 0b111], // 9
];

fn clock_icon(size: u32, hour: u32, minute: u32) -> Image<'static> {
    let px_len = (size * size * 4) as usize;
    let mut px = vec![0u8; px_len];
    let r = (size as f32 * 0.25).max(2.0); // 圆角半径
    let cell = (size / 2).max(4);          // 每个数字分到的格子

    // 圆角深色底板（上略亮、下略暗，跟时钟窗格的玻璃一个调子）
    for y in 0..size {
        for x in 0..size {
            let fx = x as f32 + 0.5;
            let fy = y as f32 + 0.5;
            let cx = fx.clamp(r, size as f32 - r);
            let cy = fy.clamp(r, size as f32 - r);
            if ((fx - cx).powi(2) + (fy - cy).powi(2)).sqrt() > r {
                continue;
            }
            let t = y as f32 / size as f32;
            let i = ((y * size + x) * 4) as usize;
            px[i] = (18.0 - 10.0 * t) as u8;
            px[i + 1] = (26.0 - 13.0 * t) as u8;
            px[i + 2] = (36.0 - 17.0 * t) as u8;
            px[i + 3] = 255;
        }
    }

    // 点阵按格子大小取整数倍：格子小就 1 倍（笔画 1 像素，别糊），
    // 格子大就放大，保证「一像素就是一像素」，系统不用缩放
    let scale = ((cell.saturating_sub(2)) / 5).max(1);
    let dw = 3 * scale;
    let dh = 5 * scale;

    // 四个数字：左上 时十位、右上 时个位、左下 分十位、右下 分个位
    let digits = [hour / 10, hour % 10, minute / 10, minute % 10];
    for (n, d) in digits.iter().enumerate() {
        let ox = (n % 2) as u32 * cell + (cell - dw) / 2;
        let oy = (n / 2) as u32 * cell + (cell - dh) / 2;
        let glyph = FONT[(*d).min(9) as usize];
        for gy in 0..5u32 {
            for gx in 0..3u32 {
                if glyph[gy as usize] & (1 << (2 - gx)) == 0 {
                    continue;
                }
                for dy in 0..scale {
                    for dx in 0..scale {
                        let x = ox + gx * scale + dx;
                        let y = oy + gy * scale + dy;
                        if x >= size || y >= size {
                            continue;
                        }
                        let i = ((y * size + x) * 4) as usize;
                        px[i] = 0x8f;
                        px[i + 1] = 0xe4;
                        px[i + 2] = 0xff;
                        px[i + 3] = 255;
                    }
                }
            }
        }
    }

    Image::new_owned(px, size, size)
}

/// 托盘要的是 SM_CXSMICON（16 逻辑像素），本机 150% 下是 24 物理像素。
fn small_icon_size() -> u32 {
    let s = unsafe { GetSystemMetrics(SM_CXSMICON) };
    if (12..=128).contains(&s) {
        s as u32
    } else {
        16
    }
}

/// Alt-Tab / 大图标场合要的是 SM_CXICON（32 逻辑像素），本机是 48 物理像素。
fn big_icon_size() -> u32 {
    let s = unsafe { GetSystemMetrics(SM_CXICON) };
    if (16..=256).contains(&s) {
        s as u32
    } else {
        32
    }
}

static BIG_ICON: AtomicIsize = AtomicIsize::new(0);
static SMALL_ICON: AtomicIsize = AtomicIsize::new(0);

fn make_hicon(size: u32, hour: u32, minute: u32) -> isize {
    // dib_entry 的字节正好就是 CreateIconFromResourceEx 要的那种单张图标资源
    let dib = dib_entry(size, &clock_icon(size, hour, minute));
    unsafe {
        CreateIconFromResourceEx(
            dib.as_ptr(),
            dib.len() as u32,
            1,
            0x0003_0000,
            size as i32,
            size as i32,
            0,
        )
    }
}

/// 把画好的时间直接设成窗口图标：ICON_BIG 管任务栏按钮/Alt-Tab，ICON_SMALL 管标题栏。
fn set_window_icons(app: &AppHandle, hour: u32, minute: u32) {
    let Some(win) = app.get_webview_window("main") else {
        return;
    };
    let Ok(hwnd) = win.hwnd() else { return };
    let hwnd = hwnd.0 as isize;

    for (slot, size, kind) in [
        (&BIG_ICON, big_icon_size(), ICON_BIG),
        (&SMALL_ICON, small_icon_size(), ICON_SMALL),
    ] {
        let icon = make_hicon(size, hour, minute);
        if icon == 0 {
            continue;
        }
        unsafe {
            SendMessageW(hwnd, WM_SETICON, kind, icon);
            // 上一次自己造的图标要销毁，否则每分钟漏一个 GDI 对象
            let old = slot.swap(icon, Ordering::Relaxed);
            if old != 0 {
                DestroyIcon(old);
            }
        }
    }
}

fn hour_of(hour: u32, is24: bool) -> u32 {
    if is24 {
        hour
    } else {
        match hour % 12 {
            0 => 12,
            v => v,
        }
    }
}

/* ══════════════ .ico：让「固定到任务栏 / 桌面快捷方式」的图标也走字 ══════════════
   快捷方式画的是它自己 IconLocation 指向的那个图标文件，所以只要每分钟把这个
   .ico 重画一遍再让 shell 刷新，固定图标/桌面图标就跟着时间走——程序收进托盘、
   甚至完全退出（靠计划任务跑 --icon-tick）都成立。 */

fn data_dir() -> Option<PathBuf> {
    let base = std::env::var("LOCALAPPDATA").ok()?;
    let dir = PathBuf::from(base).join("TimeClock");
    let _ = std::fs::create_dir_all(&dir);
    Some(dir)
}
fn ico_file() -> Option<PathBuf> {
    data_dir().map(|d| d.join("clock.ico"))
}
fn flag_file() -> Option<PathBuf> {
    data_dir().map(|d| d.join("hour24"))
}
fn load_hour24() -> bool {
    flag_file()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .map(|s| s.trim() != "0")
        .unwrap_or(true)
}
fn save_hour24(v: bool) {
    if let Some(p) = flag_file() {
        let _ = std::fs::write(p, if v { "1" } else { "0" });
    }
}
/// 安装时写下来的快捷方式清单（每行一个 .lnk 全路径）
fn shortcut_links() -> Vec<PathBuf> {
    data_dir()
        .map(|d| d.join("shortcuts.txt"))
        .and_then(|p| std::fs::read_to_string(p).ok())
        .map(|s| {
            s.lines()
                .map(|l| l.trim().trim_start_matches('\u{feff}'))
                .filter(|l| !l.is_empty())
                .map(PathBuf::from)
                .collect()
        })
        .unwrap_or_default()
}

fn bgra_bottom_up(img: &Image<'_>, size: u32) -> Vec<u8> {
    let src = img.rgba();
    let mut out = Vec::with_capacity((size * size * 4) as usize);
    for y in (0..size).rev() {
        for x in 0..size {
            let i = ((y * size + x) * 4) as usize;
            out.push(src[i + 2]);
            out.push(src[i + 1]);
            out.push(src[i]);
            out.push(src[i + 3]);
        }
    }
    out
}

/// 一个尺寸的图标数据，用最老实的 32 位 DIB（不带压缩，任何 Windows 都认）
fn dib_entry(size: u32, img: &Image<'_>) -> Vec<u8> {
    let mask_row = (size + 31) / 32 * 4;
    let mut v = Vec::with_capacity((40 + size * size * 4 + mask_row * size) as usize);
    v.extend_from_slice(&40u32.to_le_bytes());
    v.extend_from_slice(&(size as i32).to_le_bytes());
    v.extend_from_slice(&((size * 2) as i32).to_le_bytes()); // DIB 里高度要翻倍（含掩码）
    v.extend_from_slice(&1u16.to_le_bytes());
    v.extend_from_slice(&32u16.to_le_bytes());
    v.extend_from_slice(&0u32.to_le_bytes()); // BI_RGB
    v.extend_from_slice(&(size * size * 4 + mask_row * size).to_le_bytes());
    for _ in 0..4 {
        v.extend_from_slice(&0u32.to_le_bytes());
    }
    v.extend_from_slice(&bgra_bottom_up(img, size));
    v.extend(std::iter::repeat(0u8).take((mask_row * size) as usize));
    v
}

fn write_ico(path: &PathBuf, hour: u32, minute: u32) -> std::io::Result<()> {
    // 把系统可能用到的尺寸都给上，它就不用自己缩放：
    // 16/20/24 是各缩放比下的托盘小图标，24/36/48 是任务栏按钮和桌面图标
    const SIZES: [u32; 6] = [16, 20, 24, 32, 36, 48];
    let imgs: Vec<(u32, Vec<u8>)> = SIZES
        .iter()
        .map(|&s| (s, dib_entry(s, &clock_icon(s, hour, minute))))
        .collect();

    let mut out = Vec::new();
    out.extend_from_slice(&0u16.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&(imgs.len() as u16).to_le_bytes());
    let mut offset = 6 + 16 * imgs.len() as u32;
    for (s, data) in &imgs {
        out.push(*s as u8);
        out.push(*s as u8);
        out.push(0);
        out.push(0);
        out.extend_from_slice(&1u16.to_le_bytes());
        out.extend_from_slice(&32u16.to_le_bytes());
        out.extend_from_slice(&(data.len() as u32).to_le_bytes());
        out.extend_from_slice(&offset.to_le_bytes());
        offset += data.len() as u32;
    }
    for (_, data) in &imgs {
        out.extend_from_slice(data);
    }

    // 先写临时文件再改名：免得 shell 正好读到写了一半的图标。
    // 临时名带进程号——程序自己和计划任务可能在同一秒里各写一遍。
    let tmp = path.with_extension(format!("{}.tmp", std::process::id()));
    std::fs::write(&tmp, &out)?;
    std::fs::rename(&tmp, path)
}

const SHCNE_UPDATEITEM: i32 = 0x0000_2000;
const SHCNE_ASSOCCHANGED: i32 = 0x0800_0000;
const SHCNF_PATHW: u32 = 0x0005;
const SHCNF_IDLIST: u32 = 0x0000;

#[link(name = "shell32")]
extern "system" {
    fn SHChangeNotify(event: i32, flags: u32, item1: *const u16, item2: *const u16);
}

fn notify_shell(path: &std::path::Path) {
    use std::os::windows::ffi::OsStrExt;
    let mut w: Vec<u16> = path.as_os_str().encode_wide().collect();
    w.push(0);
    unsafe { SHChangeNotify(SHCNE_UPDATEITEM, SHCNF_PATHW, w.as_ptr(), std::ptr::null()) };
}

/// 程序活着时每分钟写一次心跳；计划任务据此判断要不要做「重刷新」。
fn heartbeat_file() -> Option<PathBuf> {
    data_dir().map(|d| d.join("alive"))
}
fn mark_alive() {
    if let Some(p) = heartbeat_file() {
        let _ = std::fs::write(p, b"1");
    }
}
fn clear_alive() {
    if let Some(p) = heartbeat_file() {
        let _ = std::fs::remove_file(p);
    }
}

/// 程序活着吗？看心跳有没有在 25 秒内更新过（心跳每 15 秒一次）。
/// 正常退出会直接把心跳删掉，所以这条只用来兜住「崩了 / 被强杀」的情况。
fn app_alive() -> bool {
    heartbeat_file()
        .and_then(|p| std::fs::metadata(p).ok())
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.elapsed().ok())
        .map(|e| e.as_secs() < 25)
        .unwrap_or(false)
}

/// 重画 .ico 并让 shell 刷新。
/// heavy=true 时额外发 SHCNE_ASSOCCHANGED——这是唯一能让「已固定」的任务栏按钮
/// 重新去读 .ico 的办法（实测 UPDATEITEM / UPDATEDIR 都不行：按钮只认这个）。
/// 程序在跑的时候也照样要发，因为固定按钮画的是快捷方式的图标，不看窗口图标。
fn refresh_ico_with(hour: u32, minute: u32, heavy: bool) {
    if let Some(p) = ico_file() {
        if write_ico(&p, hour, minute).is_ok() {
            notify_shell(&p);
        }
    }
    for l in shortcut_links() {
        notify_shell(&l);
    }
    if heavy {
        unsafe {
            SHChangeNotify(
                SHCNE_ASSOCCHANGED,
                SHCNF_IDLIST,
                std::ptr::null(),
                std::ptr::null(),
            )
        };
    }
}

fn refresh_ico(hour: u32, minute: u32) {
    refresh_ico_with(hour, minute, !app_alive());
}

fn apply_clock_icon(app: &AppHandle) {
    let t = local_now();
    let hour = hour_of(t.hour as u32, IS_24H.load(Ordering::Relaxed));
    // 任务栏按钮 / Alt-Tab / 标题栏
    set_window_icons(app, hour, t.minute as u32);
    if let Some(tray) = app.tray_by_id("main-tray") {
        let _ = tray.set_icon(Some(clock_icon(small_icon_size(), hour, t.minute as u32)));
        // 鼠标停在托盘图标上也能看到时间
        let _ = tray.set_tooltip(Some(format!("现在 {:02}:{:02}", hour, t.minute)));
    }
}

/// 退出时：先按最后时刻重刷一遍，再撤掉心跳——这样计划任务下一次跑（最多 1 分钟）
/// 立刻接手做重刷新，固定图标一刻都不会停在旧时间上。
fn handover_and_clear() {
    let t = local_now();
    refresh_ico_with(hour_of(t.hour as u32, IS_24H.load(Ordering::Relaxed)), t.minute as u32, true);
    clear_alive();
}

/// 距离下一个整分钟还有多少毫秒（多给 40ms，保证整分钟确实已经过了）
fn ms_to_next_minute() -> u64 {
    let t = local_now();
    (60 - t.second as u64) * 1000 - t.milliseconds as u64 + 40
}

// 每分钟对一次表：窗口图标（任务栏/Alt-Tab）、托盘图标、快捷方式用的 .ico 一起换。
// 放在 Rust 线程里，窗口收进托盘、WebView 被系统降频时也照样走。
// 关键是睡到「下一个整分钟」，而不是固定周期轮询——轮询会让整分钟过了还要再等一个周期，
// 图标就慢一拍（之前 15 秒轮询时实测要慢十来秒）。心跳另按 15 秒一次写，给计划任务判断在不在。
fn spawn_icon_ticker(app: AppHandle) {
    std::thread::spawn(move || {
        let mut last_minute = u32::MAX;
        let mut next_beat = std::time::Instant::now();
        loop {
            let t = local_now();
            let minute = t.minute as u32;
            if minute != last_minute {
                last_minute = minute;
                let hour = hour_of(t.hour as u32, IS_24H.load(Ordering::Relaxed));
                let handle = app.clone();
                let _ = app.run_on_main_thread(move || apply_clock_icon(&handle));
                refresh_ico_with(hour, minute, true);
            }
            let now = std::time::Instant::now();
            if now >= next_beat {
                mark_alive();
                next_beat = now + std::time::Duration::from_secs(15);
            }
            let to_beat = next_beat
                .saturating_duration_since(std::time::Instant::now())
                .as_millis() as u64;
            // 睡到「下一个整分钟」和「下一次心跳」里更早的那个
            let ms = ms_to_next_minute().min(to_beat).clamp(20, 15_000);
            std::thread::sleep(std::time::Duration::from_millis(ms));
        }
    });
}

#[tauri::command]
fn set_icon_format(app: AppHandle, hour24: bool) {
    IS_24H.store(hour24, Ordering::Relaxed);
    save_hour24(hour24);
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || apply_clock_icon(&handle));
    let t = local_now();
    refresh_ico_with(hour_of(t.hour as u32, hour24), t.minute as u32, true);
}

#[tauri::command]
fn toggle_always_on_top(window: tauri::WebviewWindow) -> Result<(), String> {
    let current = window.is_always_on_top().map_err(|e| e.to_string())?;
    window
        .set_always_on_top(!current)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn get_always_on_top(window: tauri::WebviewWindow) -> Result<bool, String> {
    window.is_always_on_top().map_err(|e| e.to_string())
}


/* ══════════════ 锁定：按光标位置切换「鼠标穿透」 ══════════════
   锁定时窗口整体 ignore_cursor_events = true，点哪儿都落到下面的窗口上；
   只有前端报上来的那几块「还能点」的矩形（齿轮按钮、打开的面板）例外。
   为什么要在 Rust 这边轮询：窗口一旦穿透，WebView 就收不到鼠标事件了，
   屏幕坐标系里的光标位置是唯一还能问的东西。 */
#[repr(C)]
#[derive(Default, Clone, Copy)]
struct Point {
    x: i32,
    y: i32,
}

#[repr(C)]
#[derive(Default, Clone, Copy)]
struct WinRect {
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
}

#[link(name = "user32")]
extern "system" {
    fn GetCursorPos(p: *mut Point) -> i32;
    fn GetWindowRect(hwnd: isize, r: *mut WinRect) -> i32;
}

#[derive(Default)]
struct LockState {
    locked: AtomicBool,
    rects: Mutex<Vec<[f64; 4]>>, // CSS 像素、窗口内坐标 [x, y, w, h]
}

fn hwnd_of(win: &tauri::WebviewWindow) -> isize {
    match win.hwnd() {
        Ok(h) => h.0 as isize,
        Err(_) => 0,
    }
}


#[tauri::command]
fn set_lock_state(
    app: AppHandle,
    state: tauri::State<LockState>,
    locked: bool,
    rects: Vec<[f64; 4]>,
) {
    state.locked.store(locked, Ordering::Relaxed);
    if let Ok(mut r) = state.rects.lock() {
        *r = rects;
    }
    // 解锁要马上生效，不能等下一轮轮询（不然会有几十毫秒「点不动」）
    if !locked {
        if let Some(win) = app.get_webview_window("main") {
            let _ = win.set_ignore_cursor_events(false);
        }
    }
}

fn spawn_lock_watcher(app: AppHandle) {
    std::thread::spawn(move || {
        let state = app.state::<LockState>();
        let mut ignoring = false;
        // 指针刚从「还能点」的区域挪开时，别立刻恢复穿透：手快的人常常是
        // 指针还在挪的过程中就按下了，晚个零点几秒恢复，这一下才不会掉进穿透区。
        let mut last_hit: Option<std::time::Instant> = None;
        // 锁定时窗口是穿透的，前端一个鼠标事件都收不到，玻璃的「悬停倾斜 / 下压」就没了。
        // 反正这里本来就在跟光标，顺手把光标位置报给前端，让它把悬停效果演出来。
        let mut hover_in = false;
        let mut last_hover = (f64::MIN, f64::MIN);
        let mut hover_tick: u32 = 0;
        loop {
            if !state.locked.load(Ordering::Relaxed) {
                if ignoring {
                    if let Some(win) = app.get_webview_window("main") {
                        let _ = win.set_ignore_cursor_events(false);
                    }
                    ignoring = false;
                }
                hover_in = false;
                last_hover = (f64::MIN, f64::MIN);
                std::thread::sleep(Duration::from_millis(120));
                continue;
            }

            let want_ignore = {
                let mut hit = false;
                if let Some(win) = app.get_webview_window("main") {
                    let rects: Vec<[f64; 4]> =
                        state.rects.lock().map(|r| r.clone()).unwrap_or_default();
                    let hwnd = hwnd_of(&win);
                    if hwnd != 0 {
                        let sf = win.scale_factor().unwrap_or(1.0);
                        let mut wr = WinRect::default();
                        let mut pt = Point::default();
                        unsafe {
                            GetWindowRect(hwnd, &mut wr);
                            GetCursorPos(&mut pt);
                        }
                        let x = pt.x as f64;
                        let y = pt.y as f64;
                        for r in rects.iter() {
                            let l = wr.left as f64 + r[0] * sf;
                            let t = wr.top as f64 + r[1] * sf;
                            let rt = l + r[2] * sf;
                            let bt = t + r[3] * sf;
                            if x >= l && x <= rt && y >= t && y <= bt {
                                hit = true;
                                break;
                            }
                        }
                        let inside_window = x >= wr.left as f64 && x < wr.right as f64
                            && y >= wr.top as f64 && y < wr.bottom as f64;
                        // 每 3 个 tick（约 24ms，40Hz）报一次，位置没动就不报
                        hover_tick = hover_tick.wrapping_add(1);
                        if hover_tick % 3 == 0 {
                            if inside_window {
                                let lx = (x - wr.left as f64) / sf;
                                let ly = (y - wr.top as f64) / sf;
                                if !hover_in
                                    || (lx - last_hover.0).abs() > 0.4
                                    || (ly - last_hover.1).abs() > 0.4
                                {
                                    hover_in = true;
                                    last_hover = (lx, ly);
                                    let _ = win.emit(
                                        "tc-hover",
                                        serde_json::json!({ "x": lx, "y": ly }),
                                    );
                                }
                            } else if hover_in {
                                // 离开窗口：报一次空，前端把倾斜/下压复位
                                hover_in = false;
                                let _ = win.emit("tc-hover", serde_json::Value::Null);
                            }
                        }
                    }
                }
                !hit
            };

            // 命中的瞬间记个时间戳，离开后 280ms 内仍然算「可点」
            if !want_ignore {
                last_hit = Some(std::time::Instant::now());
            }
            let in_grace = last_hit
                .map(|t| t.elapsed() < Duration::from_millis(280))
                .unwrap_or(false);
            let want_ignore = want_ignore && !in_grace;

            if want_ignore != ignoring {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.set_ignore_cursor_events(want_ignore);
                }
                ignoring = want_ignore;
            }
            // 锁定时要贴着光标跑：指针一进齿轮那块就得把窗口恢复成可点，
            // 不然「刚滑到就按下」这一下会被当成穿透，表现就是偶尔点不开设置。
            std::thread::sleep(Duration::from_millis(8));
        }
    });
}

fn build_tray_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let show_item = MenuItem::with_id(app, "show", "显示窗口", true, None::<&str>)?;
    let hide_item = MenuItem::with_id(app, "hide", "隐藏窗口", true, None::<&str>)?;
    let lock_item = MenuItem::with_id(app, "lock", "锁定 / 解锁（切换）", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;

    Menu::with_items(
        app,
        &[&show_item, &hide_item, &sep, &lock_item, &sep2, &quit_item],
    )
}

fn main() {
    // 计划任务每分钟调一次：只重画 .ico 就走人，不开窗口、不起 WebView、不显示控制台。
    // 这样程序完全没运行时，任务栏固定图标和桌面快捷方式照样走字。
    if std::env::args().any(|a| a == "--icon-tick") {
        let t = local_now();
        refresh_ico(hour_of(t.hour as u32, load_hour24()), t.minute as u32);
        return;
    }
    IS_24H.store(load_hour24(), Ordering::Relaxed);

    tauri::Builder::default()
        .manage(LockState::default())
        .setup(|app| {
            // 创建托盘图标
            let _tray = TrayIconBuilder::with_id("main-tray")
                .icon(app.default_window_icon().cloned().unwrap_or_else(|| {
                    tauri::image::Image::from_app_icon_resource(64).unwrap_or_else(|_| {
                        tauri::image::Image::new(&[0u8; 4], 1, 1)
                    })
                }))
                .menu(&build_tray_menu(app.handle())?)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    }
                    "hide" => {
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.hide();
                        }
                    }
                    "lock" => {
                        let st = app.state::<LockState>();
                        let on = !st.locked.load(Ordering::Relaxed);
                        st.locked.store(on, Ordering::Relaxed);
                        if !on {
                            if let Some(win) = app.get_webview_window("main") {
                                let _ = win.set_ignore_cursor_events(false);
                            }
                        }
                        // 让界面里的开关跟着一起变
                        let _ = app.emit("tc-lock", on);
                    }
                    "quit" => {
                        handover_and_clear();
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(win) = app.get_webview_window("main") {
                            let _ = win.show();
                            let _ = win.set_focus();
                        }
                    }
                })
                .build(app.handle())
                .expect("failed to build tray icon");

            // 图标开始按分钟走字
            spawn_icon_ticker(app.handle().clone());

            // 锁定用的光标轮询（解锁时它什么也不做）
            spawn_lock_watcher(app.handle().clone());

            // 启动时先重刷一次，顺手把「已固定」那个按钮的图标指向我们的 .ico
            mark_alive();
            let t = local_now();
            refresh_ico_with(hour_of(t.hour as u32, IS_24H.load(Ordering::Relaxed)), t.minute as u32, true);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            toggle_always_on_top,
            get_always_on_top,
            set_icon_format,
            set_lock_state
        ])
        // Alt+F4 之类把窗口关掉时也走同一套交接
        .on_window_event(|_window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                handover_and_clear();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
