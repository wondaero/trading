// ==========================================
// 1. Settings & API Management
// ==========================================
const DEFAULT_SETTINGS = {
    apiUrl: "https://uncffkzyvaapanixvniy.supabase.co/functions/v1/korea-invest-proxy",
    anonKey: ""
};

let appSettings = { ...DEFAULT_SETTINGS };

// Load settings (Fixed to production Edge Function url)
const loadSettings = () => {
    appSettings = { ...DEFAULT_SETTINGS };
};

// Normalizes API response from Supabase Edge Function to StockInfo
const adaptKoreaInvestData = (code, raw) => {
    const info = raw.stockInfo;
    console.log(raw, raw.stockInfo)
    if (!info) {
        throw new Error("주식 정보(stockInfo)를 불러오지 못했습니다. 서버 응답을 확인해주세요.");
    }

    const price = parseInt(info.stck_prpr, 10);
    const open = parseInt(raw.data[0]?.stck_oprc || info.stck_prpr, 10);

    // Calculate high and low from actual minute series, fallback to stock summary
    let high = price;
    let low = price;
    if (raw.data && raw.data.length > 0) {
        high = Math.max(...raw.data.map(b => parseInt(b.stck_hgpr || "0", 10)));
        low = Math.min(...raw.data.map(b => parseInt(b.stck_lwpr || "0", 10)));
    }

    const change = parseInt(info.prdy_vrss, 10);
    const sign = info.prdy_vrss_sign;

    const isUp = sign === "1" || sign === "2";
    const isDown = sign === "4" || sign === "5";
    const prevClose = isUp ? price - change : isDown ? price + change : price;
    const volume = parseInt(info.acml_vol, 10);

    const trPbmnInBillion = Math.round(parseInt(info.acml_tr_pbmn, 10) / 100000000);
    const marketCapStr = `거래대금 ${trPbmnInBillion.toLocaleString()}억`;

    // Draw chart with real data from Deno proxy
    let history = [];
    let historyTimes = [];

    if (raw.data && raw.data.length > 0) {
        history = raw.data.map(b => parseInt(b.stck_prpr, 10));
        historyTimes = raw.data.map(b => {
            const h = b.stck_cntg_hour.substring(0, 2);
            const m = b.stck_cntg_hour.substring(2, 4);
            return `${h}:${m}`;
        });
    } else {
        // Fallback if no candle data
        history = [open, price];
        historyTimes = ["09:00", "15:30"];
    }

    return {
        code,
        name: info.hts_kor_isnm,
        price,
        open,
        high,
        low,
        prevClose,
        volume,
        marketCap: marketCapStr,
        history,
        historyTimes
    };
};

// Fetch stock info via Supabase Proxy (GET request)
const fetchStockData = async (code) => {
    const url = appSettings.apiUrl.trim();
    if (!url) {
        throw new Error("API 프록시 URL이 설정되어 있지 않습니다. 우측 상단 설정을 확인해주세요.");
    }

    // Read date from date input (if exists) and convert YYYY-MM-DD to YYYYMMDD
    let dateStr = "";
    const dateInput = document.getElementById("stock-search-date");
    if (dateInput && dateInput.value) {
        dateStr = dateInput.value.replace(/-/g, "");
    }

    // Build GET URL with query parameter code and optional date
    const separator = url.includes("?") ? "&" : "?";
    let fetchUrl = `${url}${separator}code=${code}`;
    if (dateStr) {
        fetchUrl += `&date=${dateStr}`;
    }

    const headers = {};
    if (appSettings.anonKey.trim()) {
        headers["Authorization"] = `Bearer ${appSettings.anonKey.trim()}`;
    }

    const response = await fetch(fetchUrl, {
        method: "GET",
        headers: headers
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`API 통신 실패 (${response.status}): ${errText}`);
    }

    const result = await response.json();
    if (result.error) {
        throw new Error(result.error);
    }
    if (result.status !== "success") {
        throw new Error("데이터 조회에 실패했습니다.");
    }

    return adaptKoreaInvestData(code, result);
};

// ==========================================
// 2. Active Stock State & Details Rendering
// ==========================================
let currentActiveStock = null;

const loadActiveStock = async (code) => {
    const cardContainer = document.getElementById("stock-detail-card");
    if (!cardContainer) return;

    // Show Loading Spinner
    cardContainer.innerHTML = `
    <div class="stock-card-loading">
      <div class="spinner"></div>
      <p style="color: var(--text-muted); font-size: 0.9rem;">
        한국투자증권 API로부터 1분봉 시세를 연동 중입니다...<br>
        <span style="font-size:0.75rem; color:var(--text-dimmed); display:block; margin-top:6px;">초당 거래건수 우회 대기 적용 (약 10~15초 소요)</span>
      </p>
    </div>
  `;

    try {
        const stockInfo = await fetchStockData(code);
        currentActiveStock = stockInfo;
        renderStockCard(stockInfo);
        renderPriceChart(stockInfo);
        updateQuickListActiveState(stockInfo.code);
        updateMainAnalysisActiveState(stockInfo.code);
    } catch (error) {
        console.error(error);
        cardContainer.innerHTML = `
      <div class="stock-card-error">
        <div class="error-icon"><i data-lucide="alert-circle"></i></div>
        <h3 class="error-title">조회 실패</h3>
        <p class="error-msg">${error.message}</p>
        <button id="retry-stock-btn" class="btn btn-secondary" style="margin-top:8px;">다시 시도</button>
      </div>
    `;
        lucide.createIcons();

        // Attach retry handler
        document.getElementById("retry-stock-btn")?.addEventListener("click", () => {
            loadActiveStock(code);
        });
    }
};


const loadLimitUpStocks = async () => {
    const cardContainer = document.getElementById("stock-detail-card");
    if (!cardContainer) return;

    cardContainer.innerHTML = `
        <div class="stock-card-loading">
            <div class="spinner"></div>
            <p style="color: var(--text-muted); font-size: 0.9rem;">오늘의 실시간 급등주(20% 이상) 포착 정보를 연동 중입니다...</p>
        </div>
    `;

    try {
        const url = appSettings.apiUrl.trim();
        const separator = url.includes("?") ? "&" : "?";
        const fetchUrl = `${url}${separator}type=limitup`;

        const response = await fetch(fetchUrl);
        if (!response.ok) {
            const errText = await response.text();
            throw new Error(`급등주 조회 실패 (${response.status}): ${errText}`);
        }

        const result = await response.json();
        if (result.status !== "success") {
            throw new Error(result.error || "급등주 목록 조회 실패");
        }

        const stocksList = result.data || [];
        renderLimitUpList(stocksList);

        // Remove active state from quick access list
        updateQuickListActiveState(null);
        currentActiveStock = null;
    } catch (error) {
        console.error(error);
        cardContainer.innerHTML = `
            <div class="stock-card-error">
                <div class="error-icon"><i data-lucide="alert-circle"></i></div>
                <h3 class="error-title">조회 실패</h3>
                <p class="error-msg">${error.message}</p>
                <button id="retry-limitup-btn" class="btn btn-secondary" style="margin-top:8px;">다시 시도</button>
            </div>
        `;
        lucide.createIcons();
        document.getElementById("retry-limitup-btn")?.addEventListener("click", loadLimitUpStocks);
    }
};

const renderLimitUpList = (stocks) => {
    const cardContainer = document.getElementById("stock-detail-card");
    if (!cardContainer) return;

    // Reset card glow class
    cardContainer.className = "stock-card";

    if (!stocks || stocks.length === 0) {
        cardContainer.innerHTML = `
            <div class="stock-card-error" style="padding: 60px 20px;">
                <div class="error-icon" style="background: rgba(255, 255, 255, 0.05); color: var(--text-muted);">
                    <i data-lucide="info"></i>
                </div>
                <h3 class="error-title" style="margin-top: 10px;">급등 종목 없음</h3>
                <p class="error-msg" style="max-width: 360px; line-height: 1.5; color: var(--text-muted);">
                    현재 20% 이상 급등한 국내 주식 종목이 없습니다.<br>(장 시작 전이거나 휴장일일 수 있습니다.)
                </p>
            </div>
        `;
        lucide.createIcons();
        return;
    }

    const rowsHtml = stocks.map((stock, idx) => {
        const fullCode = stock.mksc_shrn_iscd || stock.stck_shrn_iscd || stock.code || "";
        const code = fullCode.length > 6 ? fullCode.slice(-6) : fullCode;

        const price = parseInt(stock.stck_prpr, 10).toLocaleString();
        const rate = parseFloat(stock.prdy_ctrt).toFixed(2);
        const volume = parseInt(stock.acml_vol, 10).toLocaleString();
        const marketBadge = code.startsWith("0") ? "KOSPI" : "KOSDAQ";

        return `
            <tr class="limitup-row" data-code="${code}" style="cursor: pointer;">
                <td style="width: 50px; text-align: center; color: var(--text-dimmed); font-weight: 600;">${idx + 1}</td>
                <td class="stock-name-cell">
                    ${stock.hts_kor_isnm}
                    <span class="stock-code-badge">${code}</span>
                </td>
                <td style="width: 80px; text-align: center;"><span class="badge" style="font-size: 0.7rem; background: rgba(108, 92, 231, 0.1); color: var(--color-accent); border: 1px solid rgba(108, 92, 231, 0.2);">${marketBadge}</span></td>
                <td class="price-cell" style="text-align: right;">${price}원</td>
                <td class="change-cell" style="text-align: right; color: var(--color-up); font-weight: 600;">+${rate}%</td>
                <td class="volume-cell" style="text-align: right;">${volume}주</td>
            </tr>
        `;
    }).join("");

    cardContainer.innerHTML = `
        <div class="limitup-container" style="padding: 20px;">
            <div class="limitup-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
                <div>
                    <h2 class="limitup-title" style="margin: 0; font-size: 1.15rem; display: flex; align-items: center; gap: 8px;">
                        <i data-lucide="trending-up" style="color: var(--color-up); width: 22px; height: 22px; vertical-align: middle;"></i>
                        오늘의 급등 종목 (20% 이상)
                    </h2>
                    <span class="limitup-subtitle" style="font-size: 0.75rem; color: var(--text-muted);">실시간 거래소(KRX) 당일 급등 종목 집계</span>
                </div>
                <div style="display: flex; align-items: center; gap: 12px;">
                    <div style="font-size: 0.75rem; color: var(--text-muted);">
                        총 <strong style="color: var(--color-up);">${stocks.length}</strong>개
                    </div>
                    <button id="view-all-limitups-btn" class="btn btn-primary" style="font-size: 0.72rem; padding: 4px 10px; height: 28px; display: inline-flex; align-items: center; gap: 4px;">
                        <i data-lucide="history" style="width: 12px; height: 12px;"></i>누적 이력 보기
                    </button>
                </div>
            </div>
            
            <div class="limitup-table-wrapper" style="overflow-x: auto;">
                <table class="limitup-table" style="width: 100%; border-collapse: collapse;">
                    <thead>
                        <tr style="border-bottom: 1px solid var(--border-color);">
                            <th style="text-align: center; padding: 10px; color: var(--text-muted); font-size: 0.8rem;">순위</th>
                            <th style="text-align: left; padding: 10px; color: var(--text-muted); font-size: 0.8rem;">종목명 / 코드</th>
                            <th style="text-align: center; padding: 10px; color: var(--text-muted); font-size: 0.8rem;">시장</th>
                            <th style="text-align: right; padding: 10px; color: var(--text-muted); font-size: 0.8rem;">현재가</th>
                            <th style="text-align: right; padding: 10px; color: var(--text-muted); font-size: 0.8rem;">대비율</th>
                            <th style="text-align: right; padding: 10px; color: var(--text-muted); font-size: 0.8rem;">거래량</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rowsHtml}
                    </tbody>
                </table>
            </div>
        </div>
    `;

    lucide.createIcons();

    cardContainer.querySelectorAll(".limitup-row").forEach(row => {
        row.addEventListener("click", () => {
            const code = row.dataset.code;
            loadActiveStock(code);
        });
    });

    document.getElementById("view-all-limitups-btn")?.addEventListener("click", () => {
        const limitupsTabBtn = document.querySelector('.tab-btn[data-tab="limitups"]');
        if (limitupsTabBtn) {
            limitupsTabBtn.click();
        }
    });
};

const renderStockCard = (stock) => {
    const cardContainer = document.getElementById("stock-detail-card");
    if (!cardContainer) return;

    const changePrice = stock.price - stock.prevClose;
    const changePercent = (changePrice / stock.prevClose) * 100;

    let changeClass = "color-steady";
    let signText = "";
    let arrowIcon = "";

    if (changePrice > 0) {
        changeClass = "color-up";
        signText = "+";
        arrowIcon = `<i data-lucide="trending-up" style="display:inline; width:16px; height:16px; vertical-align:middle; margin-right:4px;"></i>`;
    } else if (changePrice < 0) {
        changeClass = "color-down";
        signText = "";
        arrowIcon = `<i data-lucide="trending-down" style="display:inline; width:16px; height:16px; vertical-align:middle; margin-right:4px;"></i>`;
    }

    // Calculate percentage pointer position for today's high/low range
    let sliderPercent = 50;
    if (stock.high !== stock.low) {
        sliderPercent = ((stock.price - stock.low) / (stock.high - stock.low)) * 100;
        sliderPercent = Math.max(0, Math.min(100, sliderPercent));
    }

    // Stock card dynamic glow class mapping
    const cardTrendClass = changePrice > 0 ? "up" : changePrice < 0 ? "down" : "";
    cardContainer.className = `stock-card ${cardTrendClass}`;

    cardContainer.innerHTML = `
    <!-- Back Navigation Bar -->
    <div class="detail-back-bar">
      <button id="go-to-limitup-btn" class="limitup-back-btn">
        <i data-lucide="arrow-left"></i>급등주 목록
      </button>
    </div>

    <div class="card-top-section">
      <div class="stock-identity">
        <div class="stock-title-row">
          <h2 class="stock-name-title">${stock.name}</h2>
          <span class="stock-code-badge">${stock.code}</span>
        </div>
        <span class="stock-market-badge">한국거래소(KRX) | ${stock.code.startsWith("0") ? "KOSPI" : "KOSDAQ"}</span>
      </div>
      
      <div class="stock-price-row">
        <div class="price-current">${stock.price.toLocaleString()}원</div>
        <div class="price-change-wrapper ${changeClass}">
          ${arrowIcon}
          <span>${signText}${changePrice.toLocaleString()}원 (${signText}${changePercent.toFixed(2)}%)</span>
        </div>
      </div>
    </div>

    <!-- Range Slider Indicator -->
    <div class="range-indicator-section">
      <div class="range-labels">
        <div class="range-label-item">
          <span class="range-title">장중 최저가</span>
          <span class="range-price low">${stock.low.toLocaleString()}원</span>
        </div>
        <div class="range-label-item right">
          <span class="range-title">장중 최고가</span>
          <span class="range-price high">${stock.high.toLocaleString()}원</span>
        </div>
      </div>
      
      <div class="range-track-container">
        <div class="range-track-fill"></div>
        <div class="range-pointer" style="left: ${sliderPercent}%;"></div>
      </div>
      
      <div style="font-size:0.75rem; color:var(--text-muted); text-align:center; margin-top:-6px;">
        현재가는 금일 고저 변동폭의 하위 <strong>${sliderPercent.toFixed(0)}%</strong> 지점에 위치하고 있습니다.
      </div>
    </div>

    <!-- Additional Market Details -->
    <div class="details-grid">
      <div class="detail-item">
        <span class="detail-label">시가</span>
        <span class="detail-value">${stock.open.toLocaleString()}원</span>
      </div>
      <div class="detail-item">
        <span class="detail-label">전일 종가</span>
        <span class="detail-value">${stock.prevClose.toLocaleString()}원</span>
      </div>
      <div class="detail-item">
        <span class="detail-label">당일 거래량</span>
        <span class="detail-value">${stock.volume.toLocaleString()}주</span>
      </div>
      <div class="detail-item">
        <span class="detail-label">대금 규모</span>
        <span class="detail-value">${stock.marketCap}</span>
      </div>
    </div>
  `;

    // Render SVG icons inside the new elements
    lucide.createIcons();

    // Attach back to limitup list event listener
    document.getElementById("go-to-limitup-btn")?.addEventListener("click", () => {
        loadLimitUpStocks();
    });
};

// ==========================================
// 3. SVG Trend Chart Drawing
// ==========================================
const renderPriceChart = (stock) => {
    const svg = document.getElementById("stock-chart-svg");
    const gridGroup = document.getElementById("chart-grid-group");
    const areaPath = document.getElementById("chart-area-path");
    const linePath = document.getElementById("chart-line-path");
    const dotsGroup = document.getElementById("chart-dots-group");

    if (!svg || !stock.history || stock.history.length === 0) return;

    // Clear previous drawings
    gridGroup.innerHTML = "";
    dotsGroup.innerHTML = "";

    const width = svg.clientWidth || 600;
    const height = svg.clientHeight || 220;
    const padding = { top: 20, right: 30, bottom: 25, left: 10 };

    const history = stock.history;
    const maxPrice = Math.max(...history);
    const minPrice = Math.min(...history);
    const priceRange = maxPrice - minPrice || 100;

    // Normalize grid scaling
    const getX = (index) => padding.left + (index / (history.length - 1)) * (width - padding.left - padding.right);
    const getY = (val) => {
        const ratio = (val - minPrice) / priceRange;
        return height - padding.bottom - ratio * (height - padding.top - padding.bottom);
    };

    // 1. Draw Grid Lines (Horizontal & Vertical)
    const gridCount = 4;
    for (let i = 0; i <= gridCount; i++) {
        const ratio = i / gridCount;
        const priceVal = minPrice + ratio * priceRange;
        const y = getY(priceVal);

        // Grid line
        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute("x1", padding.left);
        line.setAttribute("y1", y);
        line.setAttribute("x2", width - padding.right);
        line.setAttribute("y2", y);
        line.setAttribute("class", "chart-grid-line");
        gridGroup.appendChild(line);

        // Text Label (Right aligned)
        const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
        text.setAttribute("x", width - padding.right + 6);
        text.setAttribute("y", y + 4);
        text.setAttribute("fill", "var(--text-dimmed)");
        text.setAttribute("font-size", "9px");
        text.setAttribute("font-family", "var(--font-primary)");
        text.innerText = Math.round(priceVal).toLocaleString();
        gridGroup.appendChild(text);
    }

    // 2. Build Line Path and Area Path
    let dLine = "";
    let dArea = "";

    history.forEach((val, idx) => {
        const x = getX(idx);
        const y = getY(val);

        if (idx === 0) {
            dLine = `M ${x} ${y}`;
            dArea = `M ${x} ${height - padding.bottom} L ${x} ${y}`;
        } else {
            dLine += ` L ${x} ${y}`;
            dArea += ` L ${x} ${y}`;
        }

        if (idx === history.length - 1) {
            dArea += ` L ${x} ${height - padding.bottom} Z`;
        }

        // 3. Draw hover trigger circles
        const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        dot.setAttribute("cx", x);
        dot.setAttribute("cy", y);
        dot.setAttribute("r", "3.5");
        dot.setAttribute("fill", "var(--color-accent)");
        dot.setAttribute("stroke", "var(--bg-secondary)");
        dot.setAttribute("stroke-width", "1.5");
        dot.setAttribute("style", "opacity: 0; transition: opacity var(--transition-fast); cursor: pointer;");
        dot.dataset.price = val;
        dot.dataset.time = stock.historyTimes ? stock.historyTimes[idx] : getFormattedTimeForIndex(idx, history.length);
        dot.dataset.index = idx;
        dotsGroup.appendChild(dot);
    });

    linePath.setAttribute("d", dLine);
    areaPath.setAttribute("d", dArea);

    // Set chart line color depending on performance (up/down)
    const isUp = (stock.price - stock.prevClose) >= 0;
    svg.style.setProperty("--color-accent", isUp ? "var(--color-up)" : "var(--color-down-kr)");

    // 4. Setup Chart Interactivity (Hover Tooltip)
    setupChartHoverInteractivity(svg, getX, getY, history, stock.historyTimes || []);
};

// Map indices to intervals between 9:00 and 15:30 (hoisted standard function)
function getFormattedTimeForIndex(index, total) {
    const startHour = 9;
    const startMin = 0;
    const totalMinutes = 390;
    const minutesInterval = totalMinutes / (total - 1);
    const totalElapsed = index * minutesInterval;

    const targetHour = Math.floor(startHour + (startMin + totalElapsed) / 60);
    const targetMin = Math.round((startMin + totalElapsed) % 60);

    return `${targetHour.toString().padStart(2, '0')}:${targetMin.toString().padStart(2, '0')}`;
}

const setupChartHoverInteractivity = (svg, getX, getY, history, historyTimes) => {
    const tooltip = document.getElementById("chart-tooltip");
    const hoverLine = document.getElementById("chart-hover-line");
    const dots = svg.querySelectorAll("#chart-dots-group circle");

    if (!tooltip || !hoverLine) return;

    const handlePointerMove = (e) => {
        const rect = svg.getBoundingClientRect();
        const xMouse = e.clientX - rect.left;

        // Find closest index in history based on mouse pointer
        let closestIndex = 0;
        let minDiff = Infinity;

        history.forEach((_, idx) => {
            const xPos = getX(idx);
            const diff = Math.abs(xMouse - xPos);
            if (diff < minDiff) {
                minDiff = diff;
                closestIndex = idx;
            }
        });

        const val = history[closestIndex];
        const xVal = getX(closestIndex);
        const yVal = getY(val);

        // Show indicator line
        hoverLine.setAttribute("x1", xVal);
        hoverLine.setAttribute("y1", 0);
        hoverLine.setAttribute("x2", xVal);
        hoverLine.setAttribute("y2", svg.clientHeight - 25);
        hoverLine.style.display = "block";

        // Highlight dot
        dots.forEach((dot, idx) => {
            if (idx === closestIndex) {
                dot.style.opacity = "1";
                dot.setAttribute("r", "5.5");
            } else {
                dot.style.opacity = "0";
                dot.setAttribute("r", "3.5");
            }
        });

        // Populate and float Tooltip
        tooltip.querySelector(".tooltip-time").innerText = historyTimes[closestIndex] || getFormattedTimeForIndex(closestIndex, history.length);
        tooltip.querySelector(".tooltip-price").innerText = `${val.toLocaleString()}원`;

        tooltip.style.display = "block";
        tooltip.style.left = `${xVal - tooltip.clientWidth / 2}px`;
        tooltip.style.top = `${yVal - tooltip.clientHeight - 12}px`;
    };

    const handlePointerLeave = () => {
        hoverLine.style.display = "none";
        tooltip.style.display = "none";
        dots.forEach(dot => {
            dot.style.opacity = "0";
            dot.setAttribute("r", "3.5");
        });
    };

    svg.addEventListener("mousemove", handlePointerMove);
    svg.addEventListener("mouseleave", handlePointerLeave);
};

// ==========================================
// 4. Sidebar Shortcuts & Search
// ==========================================
const renderQuickStocksList = () => { };
const updateQuickListActiveState = (activeCode) => { };
const updateMainAnalysisActiveState = (activeCode) => {
    const mainRows = document.querySelectorAll(".main-analysis-row");
    mainRows.forEach(row => {
        if (row.dataset.code === activeCode) {
            row.classList.add("active-row");
        } else {
            row.classList.remove("active-row");
        }
    });
};

// Fetch stock search results from proxy (GET request with search parameter)
const fetchStockSearchResults = async (query) => {
    const url = appSettings.apiUrl.trim();
    if (!url) return [];

    const separator = url.includes("?") ? "&" : "?";
    const fetchUrl = `${url}${separator}search=${encodeURIComponent(query)}`;

    const headers = {};
    if (appSettings.anonKey.trim()) {
        headers["Authorization"] = `Bearer ${appSettings.anonKey.trim()}`;
    }

    try {
        const response = await fetch(fetchUrl, {
            method: "GET",
            headers: headers
        });
        if (!response.ok) return [];
        const result = await response.json();
        if (result.status === "success" && result.data) {
            return result.data;
        }
        return [];
    } catch (e) {
        console.error("Search failed", e);
        return [];
    }
};

const initSearchBox = () => {
    const searchInput = document.getElementById("stock-search-input");
    const suggestionsBox = document.getElementById("suggestions-container");
    const searchBtn = document.getElementById("stock-search-submit-btn");
    if (!searchInput || !suggestionsBox) return;

    let debounceTimer = null;
    let selectedSuggestionIndex = -1;

    // Helper function to update the highlight class and scroll inside suggestions box
    const updateHighlight = (items) => {
        items.forEach((item, idx) => {
            if (idx === selectedSuggestionIndex) {
                item.classList.add("selected");
                // Scroll the highlighted item into view if it goes out of container height
                item.scrollIntoView({ block: "nearest" });
            } else {
                item.classList.remove("selected");
            }
        });
    };

    // Shared search function
    const performSearch = () => {
        const val = searchInput.value.trim();
        const savedCode = searchInput.dataset.code;

        if (debounceTimer) {
            clearTimeout(debounceTimer);
        }

        if (savedCode) {
            suggestionsBox.style.display = "none";
            loadActiveStock(savedCode);
            searchInput.value = "";
            searchInput.removeAttribute("data-code");
        } else if (val.length === 6 && !isNaN(val)) {
            suggestionsBox.style.display = "none";
            loadActiveStock(val);
            searchInput.value = "";
        } else if (!val) {
            suggestionsBox.style.display = "none";
            if (currentActiveStock) {
                loadActiveStock(currentActiveStock.code);
            } else {
                loadActiveStock("005930");
            }
        } else {
            alert("올바른 종목 코드 6자리를 입력하거나, 검색 결과 드롭다운에서 선택해 주세요.");
        }
    };

    // Bind click event to search submit button
    if (searchBtn) {
        searchBtn.addEventListener("click", performSearch);
    }

    // Clear saved code when the user typed something manually
    searchInput.addEventListener("input", () => {
        searchInput.removeAttribute("data-code");
    });

    // Listen on keyup to trigger dynamic autocomplete search with 1s debounce
    searchInput.addEventListener("keyup", (e) => {
        // Ignore navigation keys handled in keydown
        if (["Enter", "ArrowUp", "ArrowDown", "Escape"].includes(e.key)) {
            return;
        }

        const query = searchInput.value.trim();

        // Clear previous timer
        if (debounceTimer) {
            clearTimeout(debounceTimer);
        }

        if (!query) {
            suggestionsBox.style.display = "none";
            selectedSuggestionIndex = -1;
            return;
        }

        // Set 1-second debounce timer (1000ms)
        debounceTimer = setTimeout(async () => {
            console.log(`[SEARCH] 1초 경과하여 실시간 검색 실행: ${query}`);
            
            // Show Loading Spinner/Text during API search
            suggestionsBox.innerHTML = `
                <div style="padding: 12px 16px; color: var(--text-muted); font-size: 0.85rem; text-align: center; display: flex; align-items: center; justify-content: center; gap: 8px;">
                    <div class="spinner-mini" style="width: 14px; height: 14px; border: 2px solid rgba(255, 255, 255, 0.1); border-top: 2px solid var(--color-accent); border-radius: 50%; animation: spin 0.85s linear infinite;"></div>
                    검색 중...
                </div>
            `;
            suggestionsBox.style.display = "block";

            const results = await fetchStockSearchResults(query);

            selectedSuggestionIndex = -1; // Reset selection index

            if (results && results.length > 0) {
                suggestionsBox.innerHTML = results.map(stock => `
                    <div class="suggestion-item" data-code="${stock.code}" data-name="${stock.name}">
                        <span class="stock-name">${stock.name}</span>
                        <span class="stock-code">${stock.code}</span>
                    </div>
                `).join("");
                suggestionsBox.style.display = "block";
            } else {
                suggestionsBox.innerHTML = `
                    <div style="padding: 12px 16px; color: var(--text-muted); font-size: 0.85rem; text-align: center;">
                        검색 결과가 없습니다.
                    </div>
                `;
                suggestionsBox.style.display = "block";
            }
        }, 1000);
    });

    // Handle special keys: Escape, ArrowUp, ArrowDown, Enter
    searchInput.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            suggestionsBox.style.display = "none";
            selectedSuggestionIndex = -1;
        } else if (e.key === "ArrowDown") {
            if (suggestionsBox.style.display === "block") {
                const items = suggestionsBox.querySelectorAll(".suggestion-item");
                if (items.length > 0) {
                    e.preventDefault();
                    selectedSuggestionIndex = (selectedSuggestionIndex + 1) % items.length;
                    updateHighlight(items);
                }
            }
        } else if (e.key === "ArrowUp") {
            if (suggestionsBox.style.display === "block") {
                const items = suggestionsBox.querySelectorAll(".suggestion-item");
                if (items.length > 0) {
                    e.preventDefault();
                    if (selectedSuggestionIndex <= 0) {
                        selectedSuggestionIndex = items.length - 1;
                    } else {
                        selectedSuggestionIndex--;
                    }
                    updateHighlight(items);
                }
            }
        } else if (e.key === "Enter") {
            if (suggestionsBox.style.display === "block" && selectedSuggestionIndex !== -1) {
                const items = suggestionsBox.querySelectorAll(".suggestion-item");
                const selectedItem = items[selectedSuggestionIndex];
                if (selectedItem) {
                    e.preventDefault();
                    const code = selectedItem.dataset.code;
                    const name = selectedItem.dataset.name;

                    // Fill the input field and save code in data attribute
                    searchInput.value = name;
                    searchInput.dataset.code = code;

                    // Close suggestions and reset index
                    suggestionsBox.style.display = "none";
                    selectedSuggestionIndex = -1;

                    // Re-focus input
                    searchInput.focus();
                }
            } else {
                // Perform search by triggering searchBtn click
                e.preventDefault();
                if (searchBtn) {
                    searchBtn.click();
                } else {
                    performSearch();
                }
            }
        }
    });

    // Handle suggestion item click -> load stock immediately
    suggestionsBox.addEventListener("click", (e) => {
        const item = e.target.closest(".suggestion-item");
        if (!item) return;

        const code = item.dataset.code;
        searchInput.value = "";
        searchInput.removeAttribute("data-code");
        suggestionsBox.style.display = "none";
        selectedSuggestionIndex = -1;
        loadActiveStock(code);
    });

    // Hide suggestions box if clicking outside the search box
    document.addEventListener("click", (e) => {
        if (!searchInput.contains(e.target) && !suggestionsBox.contains(e.target)) {
            suggestionsBox.style.display = "none";
            selectedSuggestionIndex = -1;
        }
    });
};

// ==========================================
// 5. Tabs Switching Logic
// ==========================================
const initNavigationTabs = () => {
    const tabBtns = document.querySelectorAll(".tab-btn");
    const tabContents = document.querySelectorAll(".tab-content");

    tabBtns.forEach(btn => {
        btn.addEventListener("click", () => {
            const tabId = btn.dataset.tab;

            // Update buttons active states
            tabBtns.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");

            // Toggle display of content containers
            tabContents.forEach(content => {
                if (content.id === `tab-${tabId}`) {
                    content.style.display = content.tagName === "MAIN" ? "grid" : "flex";
                } else {
                    content.style.display = "none";
                }
            });

            // Force SVG chart redraw when returning to dashboard or search
            if (tabId === "dashboard" && currentActiveStock) {
                setTimeout(() => renderPriceChart(currentActiveStock), 50);
            } else if (tabId === "search" && currentSearchActiveStock) {
                setTimeout(() => renderSearchPriceChart(currentSearchActiveStock), 50);
            }
        });
    });
};

// ==========================================
// 6. Scheduler Monitor & Logs UI
// ==========================================
const loadSchedulerStatus = async () => {
    const statusDot = document.getElementById("scheduler-status-dot");
    const logsList = document.getElementById("scheduler-logs-list");
    const refreshBtn = document.getElementById("refresh-logs-btn");

    if (!statusDot || !logsList) return;

    if (refreshBtn) refreshBtn.classList.add("loading");

    const url = appSettings.apiUrl;
    const separator = url.includes("?") ? "&" : "?";
    const fetchUrl = `${url}${separator}type=sync_logs`;

    try {
        const response = await fetch(fetchUrl);
        if (!response.ok) throw new Error("API 통신 실패");
        const result = await response.json();

        if (result.status === "success" && result.data) {
            const logs = result.data;
            
            // 1. Update Status Dot based on the latest log
            if (logs.length > 0) {
                const latest = logs[0];
                statusDot.className = "status-dot";
                if (latest.status === "SUCCESS") {
                    statusDot.classList.add("success");
                } else {
                    statusDot.classList.add("failed");
                }
            } else {
                statusDot.className = "status-dot unknown";
            }

            // 2. Render Logs List
            if (logs.length === 0) {
                logsList.innerHTML = `<div class="log-empty">수집된 로그 기록이 없습니다.</div>`;
            } else {
                logsList.innerHTML = logs.map(log => {
                    const statusClass = log.status === "SUCCESS" ? "success" : "failed";
                    const statusLabel = log.status === "SUCCESS" ? "성공" : "실패";
                    const dateObj = new Date(log.created_at);
                    const formattedTime = dateObj.toLocaleString('ko-KR', {
                        month: '2-digit',
                        day: '2-digit',
                        hour: '2-digit',
                        minute: '2-digit',
                        hour12: false
                    });

                    return `
                        <div class="log-item">
                            <div class="log-item-header">
                                <span class="log-status-badge ${statusClass}">${statusLabel}</span>
                                <span class="log-time">${formattedTime}</span>
                            </div>
                            <div class="log-message">${log.message}</div>
                        </div>
                    `;
                }).join("");
            }
        } else {
            throw new Error("로그 분석 실패");
        }
    } catch (error) {
        console.error("Failed to fetch scheduler logs:", error);
        statusDot.className = "status-dot unknown";
        logsList.innerHTML = `<div class="log-empty" style="color:var(--color-up); font-size:0.8rem;">로그를 로드하지 못했습니다.</div>`;
    } finally {
        if (refreshBtn) refreshBtn.classList.remove("loading");
    }
};

const initSchedulerMonitor = () => {
    const monitorContainer = document.getElementById("scheduler-monitor-container");
    const statusBtn = document.getElementById("scheduler-status-btn");
    const refreshBtn = document.getElementById("refresh-logs-btn");

    if (!monitorContainer || !statusBtn) return;

    // Toggle Dropdown Panel
    statusBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        monitorContainer.classList.toggle("active");
        if (monitorContainer.classList.contains("active")) {
            loadSchedulerStatus();
        }
    });

    // Refresh Logs
    if (refreshBtn) {
        refreshBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            loadSchedulerStatus();
        });
    }

    // Close when clicking outside
    document.addEventListener("click", (e) => {
        if (!monitorContainer.contains(e.target)) {
            monitorContainer.classList.remove("active");
        }
    });
};

// ==========================================
// 6.5. Limitups Tab Controller
// ==========================================
// ==========================================
// 6.5. Limitups Tab Controller (Accumulated Timeline)
// ==========================================
const initLimitUpsTab = () => {
    const resultContainer = document.getElementById("limitups-result-container");
    if (!resultContainer) return;

    // Bind to the tab navigation button click to fetch data
    const limitupsTabBtn = document.querySelector('.tab-btn[data-tab="limitups"]');
    
    const queryAllLimitUps = async () => {
        resultContainer.innerHTML = `
            <div class="stock-card-loading" style="padding: 60px 20px; text-align: center; background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-md);">
                <div class="spinner"></div>
                <p style="color: var(--text-muted); margin-top: 12px;">누적 급등주 데이터를 불러오는 중...</p>
            </div>
        `;

        // Reset styling in case it was modified before
        resultContainer.style.background = "";
        resultContainer.style.border = "";
        resultContainer.style.boxShadow = "";
        resultContainer.style.backdropFilter = "";

        const url = appSettings.apiUrl;
        const separator = url.includes("?") ? "&" : "?";
        const fetchUrl = `${url}${separator}type=limitup&date=all`;

        try {
            const response = await fetch(fetchUrl);
            if (!response.ok) throw new Error("API 통신에 실패했습니다.");
            
            const result = await response.json();
            if (result.status !== "success") {
                throw new Error(result.error || "데이터 조회 실패");
            }

            const stocks = result.data || [];
            renderLimitUpsTimeline(stocks);
        } catch (error) {
            console.error(error);
            resultContainer.style.background = "";
            resultContainer.style.border = "";
            resultContainer.style.boxShadow = "";
            resultContainer.style.backdropFilter = "";
            resultContainer.innerHTML = `
                <div class="stock-card-error" style="padding: 40px 20px; text-align: center; background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-md);">
                    <div class="error-icon"><i data-lucide="alert-circle"></i></div>
                    <h3 class="error-title">조회 실패</h3>
                    <p class="error-msg">${error.message}</p>
                    <button id="retry-all-limitups-btn" class="btn btn-secondary" style="margin-top:12px;">다시 시도</button>
                </div>
            `;
            lucide.createIcons();
            document.getElementById("retry-all-limitups-btn")?.addEventListener("click", queryAllLimitUps);
        }
    };

    if (limitupsTabBtn) {
        limitupsTabBtn.addEventListener("click", () => {
            queryAllLimitUps();
        });
    }

    // Fetch initially on load to prepare cache
    queryAllLimitUps();
};

const formatDateStr = (dateStr) => {
    if (!dateStr || dateStr.length !== 8) return dateStr || "";
    const yyyy = dateStr.substring(0, 4);
    const mm = dateStr.substring(4, 6);
    const dd = dateStr.substring(6, 8);
    
    const dateObj = new Date(`${yyyy}-${mm}-${dd}`);
    const week = ['일', '월', '화', '수', '목', '금', '토'];
    const dayOfWeek = week[dateObj.getDay()] || '';
    return `${yyyy}. ${mm}. ${dd} (${dayOfWeek})`;
};

const renderLimitUpsTimeline = (stocks) => {
    const resultContainer = document.getElementById("limitups-result-container");
    if (!resultContainer) return;

    // Reset container default card backgrounds to allow flat timeline cards
    resultContainer.style.background = "transparent";
    resultContainer.style.border = "none";
    resultContainer.style.boxShadow = "none";
    resultContainer.style.backdropFilter = "none";

    if (!stocks || stocks.length === 0) {
        resultContainer.innerHTML = `
            <div class="stock-card-error" style="padding: 60px 20px; text-align: center; background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-md);">
                <div class="error-icon" style="background: rgba(255, 255, 255, 0.05); color: var(--text-muted); display: inline-flex; align-items: center; justify-content: center; width: 48px; height: 48px; border-radius: 50%;">
                    <i data-lucide="info"></i>
                </div>
                <h3 class="error-title" style="margin-top: 16px;">급등주 기록 없음</h3>
                <p class="error-msg" style="max-width: 360px; line-height: 1.5; margin: 8px auto 0; color: var(--text-muted); font-size: 0.88rem;">
                    데이터베이스에 누적 기록된 급등주 데이터가 없습니다.<br>
                    (스케줄러 작동 기록을 확인해 주세요.)
                </p>
            </div>
        `;
        lucide.createIcons();
        return;
    }

    // 1. Group stocks by date
    const groups = {};
    stocks.forEach(stock => {
        const d = stock.date || "Unknown";
        if (!groups[d]) groups[d] = [];
        groups[d].push(stock);
    });

    // 2. Sort dates descending
    const sortedDates = Object.keys(groups).sort((a, b) => b.localeCompare(a));

    // 3. Build HTML
    const timelineHtml = sortedDates.map(dateStr => {
        const dateStocks = groups[dateStr];
        const formattedDate = formatDateStr(dateStr);

        const rowsHtml = dateStocks.map((stock, idx) => {
            const fullCode = stock.mksc_shrn_iscd || stock.stck_shrn_iscd || stock.code || "";
            const code = fullCode.length > 6 ? fullCode.slice(-6) : fullCode;

            const price = parseInt(stock.stck_prpr, 10).toLocaleString();
            const rate = parseFloat(stock.prdy_ctrt).toFixed(2);
            const volume = parseInt(stock.acml_vol, 10).toLocaleString();
            const marketBadge = code.startsWith("0") ? "KOSPI" : "KOSDAQ";

            return `
                <tr class="limitup-row" data-code="${code}" style="cursor: pointer;">
                    <td style="width: 50px; text-align: center; color: var(--text-dimmed); font-weight: 600;">${idx + 1}</td>
                    <td class="stock-name-cell">
                        ${stock.hts_kor_isnm}
                        <span class="stock-code-badge">${code}</span>
                    </td>
                    <td style="width: 80px; text-align: center;">
                        <span class="badge" style="font-size: 0.7rem; background: rgba(108, 92, 231, 0.1); color: var(--color-accent); border: 1px solid rgba(108, 92, 231, 0.2);">${marketBadge}</span>
                    </td>
                    <td class="price-cell" style="text-align: right;">${price}원</td>
                    <td class="change-cell" style="text-align: right; color: var(--color-up); font-weight: 600;">+${rate}%</td>
                    <td class="volume-cell" style="text-align: right;">${volume}주</td>
                </tr>
            `;
        }).join("");

        return `
            <div class="timeline-section">
                <div class="timeline-date-header">
                    <h3 class="timeline-date-title">
                        <i data-lucide="calendar" style="color: var(--color-accent); width: 18px; height: 18px;"></i>
                        ${formattedDate}
                    </h3>
                    <span class="timeline-count-badge">
                        급등 종목 수: <strong style="color: var(--color-up);">${dateStocks.length}</strong>개
                    </span>
                </div>
                
                <div class="limitups-table-wrapper" style="overflow-x: auto;">
                    <table class="limitup-table" style="width: 100%; border-collapse: collapse;">
                        <thead>
                            <tr style="border-bottom: 1px solid var(--border-color);">
                                <th style="text-align: center; padding: 10px; color: var(--text-muted); font-size: 0.8rem;">순위</th>
                                <th style="text-align: left; padding: 10px; color: var(--text-muted); font-size: 0.8rem;">종목명 / 코드</th>
                                <th style="text-align: center; padding: 10px; color: var(--text-muted); font-size: 0.8rem;">시장</th>
                                <th style="text-align: right; padding: 10px; color: var(--text-muted); font-size: 0.8rem;">현재가</th>
                                <th style="text-align: right; padding: 10px; color: var(--text-muted); font-size: 0.8rem;">대비율</th>
                                <th style="text-align: right; padding: 10px; color: var(--text-muted); font-size: 0.8rem;">거래량</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rowsHtml}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    }).join("");

    resultContainer.innerHTML = timelineHtml;
    lucide.createIcons();

    // Attach click listeners to return to Main with active stock loaded
    resultContainer.querySelectorAll(".limitup-row").forEach(row => {
        row.addEventListener("click", () => {
            const code = row.dataset.code;
            
            // Switch active tab to dashboard (Main)
            const dashTabBtn = document.querySelector('.tab-btn[data-tab="dashboard"]');
            if (dashTabBtn) {
                dashTabBtn.click();
            }

            // Load stock in dashboard
            loadActiveStock(code);
        });
    });
};

// ==========================================
// 6.6. Search Tab Controller & History Manager
// ==========================================
let currentSearchActiveStock = null;

const renderSearchStockCard = (stock) => {
    const cardContainer = document.getElementById("search-detail-card");
    if (!cardContainer) return;

    const changePrice = stock.price - stock.prevClose;
    const changePercent = (changePrice / stock.prevClose) * 100;

    let changeClass = "color-steady";
    let signText = "";
    let arrowIcon = "";

    if (changePrice > 0) {
        changeClass = "color-up";
        signText = "+";
        arrowIcon = `<i data-lucide="trending-up" style="display:inline; width:16px; height:16px; vertical-align:middle; margin-right:4px;"></i>`;
    } else if (changePrice < 0) {
        changeClass = "color-down";
        signText = "";
        arrowIcon = `<i data-lucide="trending-down" style="display:inline; width:16px; height:16px; vertical-align:middle; margin-right:4px;"></i>`;
    }

    let sliderPercent = 50;
    if (stock.high !== stock.low) {
        sliderPercent = ((stock.price - stock.low) / (stock.high - stock.low)) * 100;
        sliderPercent = Math.max(0, Math.min(100, sliderPercent));
    }

    const cardTrendClass = changePrice > 0 ? "up" : changePrice < 0 ? "down" : "";
    cardContainer.className = `stock-card ${cardTrendClass}`;

    cardContainer.innerHTML = `
    <div class="card-top-section" style="padding-top: 10px;">
      <div class="stock-identity">
        <div class="stock-title-row">
          <h2 class="stock-name-title">${stock.name}</h2>
          <span class="stock-code-badge">${stock.code}</span>
        </div>
        <span class="stock-market-badge">한국거래소(KRX) | ${stock.code.startsWith("0") ? "KOSPI" : "KOSDAQ"}</span>
      </div>
      
      <div class="stock-price-row">
        <div class="price-current">${stock.price.toLocaleString()}원</div>
        <div class="price-change-wrapper ${changeClass}">
          ${arrowIcon}
          <span>${signText}${changePrice.toLocaleString()}원 (${signText}${changePercent.toFixed(2)}%)</span>
        </div>
      </div>
    </div>

    <!-- Range Slider Indicator -->
    <div class="range-indicator-section">
      <div class="range-labels">
        <div class="range-label-item">
          <span class="range-title">장중 최저가</span>
          <span class="range-price low">${stock.low.toLocaleString()}원</span>
        </div>
        <div class="range-label-item right">
          <span class="range-title">장중 최고가</span>
          <span class="range-price high">${stock.high.toLocaleString()}원</span>
        </div>
      </div>
      
      <div class="range-track-container">
        <div class="range-track-fill"></div>
        <div class="range-pointer" style="left: ${sliderPercent}%;"></div>
      </div>
      
      <div style="font-size:0.75rem; color:var(--text-muted); text-align:center; margin-top:-6px;">
        현재가는 금일 고저 변동폭의 하위 <strong>${sliderPercent.toFixed(0)}%</strong> 지점에 위치하고 있습니다.
      </div>
    </div>

    <!-- Additional Market Details -->
    <div class="details-grid">
      <div class="detail-item">
        <span class="detail-label">시가</span>
        <span class="detail-value">${stock.open.toLocaleString()}원</span>
      </div>
      <div class="detail-item">
        <span class="detail-label">전일 종가</span>
        <span class="detail-value">${stock.prevClose.toLocaleString()}원</span>
      </div>
      <div class="detail-item">
        <span class="detail-label">당일 거래량</span>
        <span class="detail-value">${stock.volume.toLocaleString()}주</span>
      </div>
      <div class="detail-item">
        <span class="detail-label">대금 규모</span>
        <span class="detail-value">${stock.marketCap}</span>
      </div>
    </div>
  `;

    lucide.createIcons();
};

const renderSearchPriceChart = (stock) => {
    const svg = document.getElementById("search-chart-svg");
    const gridGroup = document.getElementById("search-chart-grid-group");
    const areaPath = document.getElementById("search-chart-area-path");
    const linePath = document.getElementById("search-chart-line-path");
    const dotsGroup = document.getElementById("search-chart-dots-group");

    if (!svg || !stock.history || stock.history.length === 0) return;

    gridGroup.innerHTML = "";
    dotsGroup.innerHTML = "";

    const width = svg.clientWidth || 600;
    const height = svg.clientHeight || 280;
    const padding = { top: 20, right: 30, bottom: 25, left: 10 };

    const history = stock.history;
    const maxPrice = Math.max(...history);
    const minPrice = Math.min(...history);
    const priceRange = maxPrice - minPrice || 100;

    const getX = (index) => padding.left + (index / (history.length - 1)) * (width - padding.left - padding.right);
    const getY = (val) => {
        const ratio = (val - minPrice) / priceRange;
        return height - padding.bottom - ratio * (height - padding.top - padding.bottom);
    };

    const gridCount = 4;
    for (let i = 0; i <= gridCount; i++) {
        const ratio = i / gridCount;
        const priceVal = minPrice + ratio * priceRange;
        const y = getY(priceVal);

        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute("x1", padding.left);
        line.setAttribute("y1", y);
        line.setAttribute("x2", width - padding.right);
        line.setAttribute("y2", y);
        line.setAttribute("class", "chart-grid-line");
        gridGroup.appendChild(line);

        const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
        text.setAttribute("x", width - padding.right + 6);
        text.setAttribute("y", y + 4);
        text.setAttribute("fill", "var(--text-dimmed)");
        text.setAttribute("font-size", "9px");
        text.setAttribute("font-family", "var(--font-primary)");
        text.innerText = Math.round(priceVal).toLocaleString();
        gridGroup.appendChild(text);
    }

    let dLine = "";
    let dArea = "";

    history.forEach((val, idx) => {
        const x = getX(idx);
        const y = getY(val);

        if (idx === 0) {
            dLine = `M ${x} ${y}`;
            dArea = `M ${x} ${height - padding.bottom} L ${x} ${y}`;
        } else {
            dLine += ` L ${x} ${y}`;
            dArea += ` L ${x} ${y}`;
        }

        if (idx === history.length - 1) {
            dArea += ` L ${x} ${height - padding.bottom} Z`;
        }

        const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        dot.setAttribute("cx", x);
        dot.setAttribute("cy", y);
        dot.setAttribute("r", "3.5");
        dot.setAttribute("fill", "var(--color-accent)");
        dot.setAttribute("stroke", "var(--bg-secondary)");
        dot.setAttribute("stroke-width", "1.5");
        dot.setAttribute("style", "opacity: 0; transition: opacity var(--transition-fast); cursor: pointer;");
        dot.dataset.price = val;
        dot.dataset.time = stock.historyTimes ? stock.historyTimes[idx] : getFormattedTimeForIndex(idx, history.length);
        dot.dataset.index = idx;
        dotsGroup.appendChild(dot);
    });

    linePath.setAttribute("d", dLine);
    areaPath.setAttribute("d", dArea);

    const isUp = (stock.price - stock.prevClose) >= 0;
    svg.style.setProperty("--color-accent", isUp ? "var(--color-up)" : "var(--color-down-kr)");

    setupSearchChartHoverInteractivity(svg, getX, getY, history, stock.historyTimes || []);
};

const setupSearchChartHoverInteractivity = (svg, getX, getY, history, historyTimes) => {
    const tooltip = document.getElementById("search-chart-tooltip");
    const hoverLine = document.getElementById("search-chart-hover-line");
    const dots = svg.querySelectorAll("#search-chart-dots-group circle");

    if (!tooltip || !hoverLine) return;

    const handlePointerMove = (e) => {
        const rect = svg.getBoundingClientRect();
        const xMouse = e.clientX - rect.left;

        let closestIndex = 0;
        let minDiff = Infinity;

        history.forEach((_, idx) => {
            const xPos = getX(idx);
            const diff = Math.abs(xMouse - xPos);
            if (diff < minDiff) {
                minDiff = diff;
                closestIndex = idx;
            }
        });

        const val = history[closestIndex];
        const xVal = getX(closestIndex);
        const yVal = getY(val);

        hoverLine.setAttribute("x1", xVal);
        hoverLine.setAttribute("y1", 0);
        hoverLine.setAttribute("x2", xVal);
        hoverLine.setAttribute("y2", svg.clientHeight - 25);
        hoverLine.style.display = "block";

        dots.forEach((dot, idx) => {
            if (idx === closestIndex) {
                dot.style.opacity = "1";
                dot.setAttribute("r", "5.5");
            } else {
                dot.style.opacity = "0";
                dot.setAttribute("r", "3.5");
            }
        });

        tooltip.querySelector(".tooltip-time").innerText = historyTimes[closestIndex] || getFormattedTimeForIndex(closestIndex, history.length);
        tooltip.querySelector(".tooltip-price").innerText = `${val.toLocaleString()}원`;

        tooltip.style.display = "block";
        tooltip.style.left = `${xVal - tooltip.clientWidth / 2}px`;
        tooltip.style.top = `${yVal - tooltip.clientHeight - 12}px`;
    };

    const handlePointerLeave = () => {
        hoverLine.style.display = "none";
        tooltip.style.display = "none";
        dots.forEach(dot => {
            dot.style.opacity = "0";
            dot.setAttribute("r", "3.5");
        });
    };

    svg.addEventListener("mousemove", handlePointerMove);
    svg.addEventListener("mouseleave", handlePointerLeave);
};

const loadSearchActiveStock = async (code) => {
    const cardContainer = document.getElementById("search-detail-card");
    if (!cardContainer) return;

    cardContainer.innerHTML = `
    <div class="stock-card-loading" style="padding: 100px 20px;">
      <div class="spinner"></div>
      <p style="color: var(--text-muted); font-size: 0.9rem;">
        한국투자증권 API로부터 1분봉 시세를 연동 중입니다...<br>
        <span style="font-size:0.75rem; color:var(--text-dimmed); display:block; margin-top:6px;">초당 거래건수 우회 대기 적용 (약 10~15초 소요)</span>
      </p>
    </div>
  `;

    try {
        const stockInfo = await fetchSearchStockData(code);
        currentSearchActiveStock = stockInfo;
        renderSearchStockCard(stockInfo);
        renderSearchPriceChart(stockInfo);
        
        // Add to history
        addSearchHistory(stockInfo.code, stockInfo.name);
    } catch (error) {
        console.error(error);
        cardContainer.innerHTML = `
      <div class="stock-card-error" style="padding: 60px 20px;">
        <div class="error-icon"><i data-lucide="alert-circle"></i></div>
        <h3 class="error-title">조회 실패</h3>
        <p class="error-msg">${error.message}</p>
        <button id="retry-search-stock-btn" class="btn btn-secondary" style="margin-top:8px;">다시 시도</button>
      </div>
    `;
        lucide.createIcons();

        document.getElementById("retry-search-stock-btn")?.addEventListener("click", () => {
            loadSearchActiveStock(code);
        });
    }
};

const fetchSearchStockData = async (code) => {
    const url = appSettings.apiUrl.trim();
    if (!url) {
        throw new Error("API 프록시 URL이 설정되어 있지 않습니다.");
    }

    let dateStr = "";
    const dateInput = document.getElementById("search-tab-date");
    if (dateInput && dateInput.value) {
        dateStr = dateInput.value.replace(/-/g, "");
    }

    const separator = url.includes("?") ? "&" : "?";
    let fetchUrl = `${url}${separator}code=${code}`;
    if (dateStr) {
        fetchUrl += `&date=${dateStr}`;
    }

    const headers = {};
    if (appSettings.anonKey.trim()) {
        headers["Authorization"] = `Bearer ${appSettings.anonKey.trim()}`;
    }

    const response = await fetch(fetchUrl, {
        method: "GET",
        headers: headers
    });

    if (!response.ok) {
        const errText = await response.text();
        throw new Error(`API 통신 실패 (${response.status}): ${errText}`);
    }

    const result = await response.json();
    if (result.error) {
        throw new Error(result.error);
    }
    if (result.status !== "success") {
        throw new Error("데이터 조회에 실패했습니다.");
    }

    return adaptKoreaInvestData(code, result);
};

const initSearchTabBox = () => {
    const searchInput = document.getElementById("search-tab-input");
    const suggestionsBox = document.getElementById("search-suggestions-container");
    const searchBtn = document.getElementById("search-tab-submit-btn");
    if (!searchInput || !suggestionsBox) return;

    let debounceTimer = null;
    let selectedSuggestionIndex = -1;

    const updateHighlight = (items) => {
        items.forEach((item, idx) => {
            if (idx === selectedSuggestionIndex) {
                item.classList.add("selected");
                item.scrollIntoView({ block: "nearest" });
            } else {
                item.classList.remove("selected");
            }
        });
    };

    const performSearch = () => {
        const val = searchInput.value.trim();
        const savedCode = searchInput.dataset.code;

        if (debounceTimer) {
            clearTimeout(debounceTimer);
        }

        if (savedCode) {
            suggestionsBox.style.display = "none";
            loadSearchActiveStock(savedCode);
            searchInput.value = "";
            searchInput.removeAttribute("data-code");
        } else if (val.length === 6 && !isNaN(val)) {
            suggestionsBox.style.display = "none";
            loadSearchActiveStock(val);
            searchInput.value = "";
        } else {
            alert("올바른 종목 코드 6자리를 입력하거나, 검색 결과 드롭다운에서 선택해 주세요.");
        }
    };

    if (searchBtn) {
        searchBtn.addEventListener("click", performSearch);
    }

    searchInput.addEventListener("input", () => {
        searchInput.removeAttribute("data-code");
    });

    searchInput.addEventListener("keyup", (e) => {
        if (["Enter", "ArrowUp", "ArrowDown", "Escape"].includes(e.key)) {
            return;
        }

        const query = searchInput.value.trim();

        if (debounceTimer) {
            clearTimeout(debounceTimer);
        }

        if (!query) {
            suggestionsBox.style.display = "none";
            selectedSuggestionIndex = -1;
            return;
        }

        debounceTimer = setTimeout(async () => {
            suggestionsBox.innerHTML = `
                <div style="padding: 12px 16px; color: var(--text-muted); font-size: 0.85rem; text-align: center; display: flex; align-items: center; justify-content: center; gap: 8px;">
                    <div class="spinner-mini" style="width: 14px; height: 14px; border: 2px solid rgba(255, 255, 255, 0.1); border-top: 2px solid var(--color-accent); border-radius: 50%; animation: spin 0.85s linear infinite;"></div>
                    검색 중...
                </div>
            `;
            suggestionsBox.style.display = "block";

            const results = await fetchStockSearchResults(query);

            selectedSuggestionIndex = -1;

            if (results && results.length > 0) {
                suggestionsBox.innerHTML = results.map(stock => `
                    <div class="suggestion-item" data-code="${stock.code}" data-name="${stock.name}">
                        <span class="stock-name">${stock.name}</span>
                        <span class="stock-code">${stock.code}</span>
                    </div>
                `).join("");
                suggestionsBox.style.display = "block";
            } else {
                suggestionsBox.innerHTML = `
                    <div style="padding: 12px 16px; color: var(--text-muted); font-size: 0.85rem; text-align: center;">
                        검색 결과가 없습니다.
                    </div>
                `;
                suggestionsBox.style.display = "block";
            }
        }, 1000);
    });

    searchInput.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            suggestionsBox.style.display = "none";
            selectedSuggestionIndex = -1;
        } else if (e.key === "ArrowDown") {
            if (suggestionsBox.style.display === "block") {
                const items = suggestionsBox.querySelectorAll(".suggestion-item");
                if (items.length > 0) {
                    e.preventDefault();
                    selectedSuggestionIndex = (selectedSuggestionIndex + 1) % items.length;
                    updateHighlight(items);
                }
            }
        } else if (e.key === "ArrowUp") {
            if (suggestionsBox.style.display === "block") {
                const items = suggestionsBox.querySelectorAll(".suggestion-item");
                if (items.length > 0) {
                    e.preventDefault();
                    if (selectedSuggestionIndex <= 0) {
                        selectedSuggestionIndex = items.length - 1;
                    } else {
                        selectedSuggestionIndex--;
                    }
                    updateHighlight(items);
                }
            }
        } else if (e.key === "Enter") {
            if (suggestionsBox.style.display === "block" && selectedSuggestionIndex !== -1) {
                const items = suggestionsBox.querySelectorAll(".suggestion-item");
                const selectedItem = items[selectedSuggestionIndex];
                if (selectedItem) {
                    e.preventDefault();
                    const code = selectedItem.dataset.code;
                    const name = selectedItem.dataset.name;

                    searchInput.value = name;
                    searchInput.dataset.code = code;

                    suggestionsBox.style.display = "none";
                    selectedSuggestionIndex = -1;
                    searchInput.focus();
                }
            } else {
                e.preventDefault();
                performSearch();
            }
        }
    });

    suggestionsBox.addEventListener("click", (e) => {
        const item = e.target.closest(".suggestion-item");
        if (!item) return;

        const code = item.dataset.code;
        searchInput.value = "";
        searchInput.removeAttribute("data-code");
        suggestionsBox.style.display = "none";
        selectedSuggestionIndex = -1;
        loadSearchActiveStock(code);
    });

    document.addEventListener("click", (e) => {
        if (!searchInput.contains(e.target) && !suggestionsBox.contains(e.target)) {
            suggestionsBox.style.display = "none";
            selectedSuggestionIndex = -1;
        }
    });
};

const HISTORY_KEY = "stock_search_history";

const loadSearchHistory = () => {
    try {
        const data = localStorage.getItem(HISTORY_KEY);
        return data ? JSON.parse(data) : [];
    } catch (e) {
        console.error("Failed to load search history", e);
        return [];
    }
};

const addSearchHistory = (code, name) => {
    let history = loadSearchHistory();
    history = history.filter(item => item.code !== code);
    history.unshift({ code, name });
    if (history.length > 10) {
        history = history.slice(0, 10);
    }
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    renderSearchHistory();
};

const removeSearchHistory = (code) => {
    let history = loadSearchHistory();
    history = history.filter(item => item.code !== code);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    renderSearchHistory();
};

const clearAllSearchHistory = () => {
    localStorage.removeItem(HISTORY_KEY);
    renderSearchHistory();
};

const renderSearchHistory = () => {
    const historyBox = document.getElementById("search-history-box");
    const chipsContainer = document.getElementById("search-history-chips");

    if (!historyBox || !chipsContainer) return;

    const history = loadSearchHistory();

    if (history.length === 0) {
        historyBox.style.display = "none";
        chipsContainer.innerHTML = "";
        return;
    }

    historyBox.style.display = "flex";
    chipsContainer.innerHTML = history.map(item => `
        <div class="history-chip" data-code="${item.code}">
            <span>${item.name}</span>
            <span style="font-size: 0.7rem; color: var(--text-dimmed); margin-left: 2px;">${item.code}</span>
            <button class="delete-chip-btn" data-code="${item.code}">&times;</button>
        </div>
    `).join("");

    chipsContainer.querySelectorAll(".history-chip").forEach(chip => {
        chip.addEventListener("click", (e) => {
            if (e.target.classList.contains("delete-chip-btn")) {
                e.stopPropagation();
                const code = e.target.dataset.code;
                removeSearchHistory(code);
                return;
            }
            const code = chip.dataset.code;
            loadSearchActiveStock(code);
        });
    });
};

const initSearchTab = () => {
    initSearchTabBox();
    renderSearchHistory();
    
    const clearBtn = document.getElementById("clear-all-history-btn");
    if (clearBtn) {
        clearBtn.addEventListener("click", clearAllSearchHistory);
    }
    
    // Set default search date
    const dateInput = document.getElementById("search-tab-date");
    if (dateInput) {
        const today = new Date();
        const yyyy = today.getFullYear();
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const dd = String(today.getDate()).padStart(2, '0');
        dateInput.value = `${yyyy}-${mm}-${dd}`;
    }
};

// ==========================================
// 6.7. Main Tab Analysis Widget
// ==========================================
let mainAnalysisData = [];
let hasLoadedInitialStock = false;

const initMainAnalysisWidget = () => {
    const resultContainer = document.getElementById("main-analysis-result-container");
    const refSelect = document.getElementById("main-analysis-ref-select");
    const pctInput = document.getElementById("main-analysis-pct-input");
    const pctBtns = document.querySelectorAll(".main-filter-pct-btn");
    const exportBtn = document.getElementById("main-analysis-export-btn");

    if (!resultContainer) return;

    let activeFilterPct = 0;

    const queryMainGainerResults = async () => {
        resultContainer.innerHTML = `
            <div class="stock-card-loading" style="padding: 40px 20px; text-align: center;">
                <div class="spinner"></div>
                <p style="color: var(--text-muted); margin-top: 12px;">분석 데이터를 불러오는 중...</p>
            </div>
        `;

        const url = appSettings.apiUrl;
        const separator = url.includes("?") ? "&" : "?";
        const fetchUrl = `${url}${separator}type=gainer_results`;

        try {
            const response = await fetch(fetchUrl);
            if (!response.ok) throw new Error("API 통신에 실패했습니다.");
            const result = await response.json();
            if (result.status !== "success") {
                throw new Error(result.error || "데이터 조회 실패");
            }

            mainAnalysisData = result.data || [];
            applyFiltersAndRender();
        } catch (error) {
            console.error(error);
            resultContainer.innerHTML = `
                <div class="stock-card-error" style="padding: 30px 20px; text-align: center;">
                    <div class="error-icon"><i data-lucide="alert-circle"></i></div>
                    <h3 class="error-title" style="font-size: 1rem;">조회 실패</h3>
                    <p class="error-msg" style="font-size: 0.8rem;">${error.message}</p>
                    <button id="retry-main-analysis-btn" class="btn btn-secondary" style="margin-top:10px; font-size: 0.75rem; padding: 4px 10px;">다시 시도</button>
                </div>
            `;
            lucide.createIcons();
            document.getElementById("retry-main-analysis-btn")?.addEventListener("click", queryMainGainerResults);
        }
    };

    const applyFiltersAndRender = () => {
        if (mainAnalysisData.length === 0) {
            resultContainer.innerHTML = `
                <div class="stock-card-error" style="padding: 40px 20px; text-align: center;">
                    <div class="error-icon"><i data-lucide="info"></i></div>
                    <h3 class="error-title" style="font-size:1rem; margin-top: 8px;">데이터 없음</h3>
                    <p class="error-msg" style="font-size:0.8rem; color: var(--text-muted);">
                        수집된 분석 데이터가 없습니다.<br>16:30 장마감 이후 최초 수집이 실행됩니다.
                    </p>
                </div>
            `;
            lucide.createIcons();
            if (!hasLoadedInitialStock) {
                loadActiveStock("005930");
                hasLoadedInitialStock = true;
            }
            return;
        }

        // 1. Find the latest date
        const dates = [...new Set(mainAnalysisData.map(row => row.date))].sort((a, b) => b.localeCompare(a));
        const latestDate = dates[0];
        
        // 2. Filter for latest date
        const latestDayData = mainAnalysisData.filter(row => row.date === latestDate);

        // 3. Apply percentage filters
        const refType = refSelect.value;
        const threshold = parseFloat(pctInput.value) || activeFilterPct;

        const filtered = latestDayData.filter(row => {
            const open = parseFloat(row.open_price) || 0;
            const high = parseFloat(row.high_price) || 0;
            const prevClose = parseFloat(row.prev_close_price) || 0;

            if (open <= 0 || prevClose <= 0) return false;

            let rate = 0;
            if (refType === "open") {
                rate = ((high - open) / open) * 100;
            } else {
                rate = ((high - prevClose) / prevClose) * 100;
            }

            return rate >= threshold;
        });

        renderTable(filtered, refType, latestDate);
    };

    const renderTable = (data, refType, dateStr) => {
        if (!data || data.length === 0) {
            resultContainer.innerHTML = `
                <div class="stock-card-error" style="padding: 40px 20px; text-align: center;">
                    <div class="error-icon" style="background: rgba(255, 255, 255, 0.05); color: var(--text-muted); display: inline-flex; align-items: center; justify-content: center; width: 40px; height: 40px; border-radius: 50%;">
                        <i data-lucide="info"></i>
                    </div>
                    <h3 class="error-title" style="font-size: 0.95rem; margin-top: 10px;">조건 만족 종목 없음</h3>
                    <p class="error-msg" style="font-size:0.8rem; color: var(--text-muted);">
                        조건에 부합하는 종목이 없습니다. (기준 날짜: ${formatDateStr(dateStr)})
                    </p>
                </div>
            `;
            lucide.createIcons();
            return;
        }

        const tableRows = data.map((row, idx) => {
            const fullCode = row.code || "";
            const code = fullCode.length > 6 ? fullCode.slice(-6) : fullCode;
            const open = Math.round(row.open_price).toLocaleString();
            const high = Math.round(row.high_price).toLocaleString();
            const prevClose = Math.round(row.prev_close_price).toLocaleString();
            const volume = Math.round(row.volume).toLocaleString();

            const openToHighRate = (((row.high_price - row.open_price) / row.open_price) * 100).toFixed(2);
            const closeToHighRate = (((row.high_price - row.prev_close_price) / row.prev_close_price) * 100).toFixed(2);

            const openRateHtml = `<span style="font-weight:600; color:${parseFloat(openToHighRate) >= 5 ? 'var(--color-up)' : 'var(--text-main)'}">+${openToHighRate}%</span>`;
            const closeRateHtml = `<span style="font-weight:600; color:${parseFloat(closeToHighRate) >= 5 ? 'var(--color-up)' : 'var(--text-main)'}">+${closeToHighRate}%</span>`;

            const isActive = currentActiveStock && currentActiveStock.code === code ? "active-row" : "";

            return `
                <tr class="main-analysis-row ${isActive}" data-code="${code}" style="cursor: pointer;">
                    <td style="text-align: center; color: var(--text-dimmed); font-size: 0.78rem; font-weight:600;">${idx + 1}</td>
                    <td class="stock-name-cell" style="font-size: 0.82rem; font-weight:500;">
                        ${row.name}
                        <span class="stock-code-badge" style="font-size:0.7rem; padding: 1px 4px;">${code}</span>
                    </td>
                    <td style="text-align: right; color: var(--text-muted); font-size:0.8rem;">${prevClose}</td>
                    <td style="text-align: right; color: var(--text-main); font-size:0.8rem; font-weight:500;">${high}</td>
                    <td style="text-align: center; font-size:0.8rem;">${openRateHtml}</td>
                    <td style="text-align: center; font-size:0.8rem;">${closeRateHtml}</td>
                    <td style="text-align: right; font-size: 0.75rem; color: var(--text-dimmed);">${volume}</td>
                </tr>
            `;
        }).join("");

        resultContainer.innerHTML = `
            <div class="limitup-container" style="padding: 0;">
                <div style="font-size: 0.72rem; color: var(--text-dimmed); padding: 8px 12px; border-bottom: 1px solid var(--border-color); background: rgba(0,0,0,0.1); display: flex; justify-content: space-between;">
                    <span>기준 거래일: <strong>${formatDateStr(dateStr)}</strong></span>
                    <span>총 <strong>${data.length}</strong>개 종목</span>
                </div>
                <div class="limitup-table-wrapper" style="overflow-x: auto; max-height: 400px;">
                    <table class="limitup-table" style="width: 100%; border-collapse: collapse;">
                      <thead>
                        <tr style="border-bottom: 1px solid var(--border-color); position: sticky; top: 0; background: var(--bg-secondary); z-index:2;">
                          <th style="text-align: center; padding: 8px 6px; color: var(--text-muted); font-size: 0.74rem; width:35px;">순위</th>
                          <th style="text-align: left; padding: 8px 6px; color: var(--text-muted); font-size: 0.74rem;">종목명</th>
                          <th style="text-align: right; padding: 8px 6px; color: var(--text-muted); font-size: 0.74rem; width:70px;">전일종가</th>
                          <th style="text-align: right; padding: 8px 6px; color: var(--text-muted); font-size: 0.74rem; width:70px;">오늘고가</th>
                          <th style="text-align: center; padding: 8px 6px; color: var(--text-muted); font-size: 0.74rem; width:75px;">시가대비고</th>
                          <th style="text-align: center; padding: 8px 6px; color: var(--text-muted); font-size: 0.74rem; width:75px;">전일비고</th>
                          <th style="text-align: right; padding: 8px 6px; color: var(--text-muted); font-size: 0.74rem;">거래량</th>
                        </tr>
                      </thead>
                      <tbody>
                        ${tableRows}
                      </tbody>
                    </table>
                </div>
            </div>
        `;

        lucide.createIcons();

        // Row click handler to load stock chart in right column
        resultContainer.querySelectorAll(".main-analysis-row").forEach(row => {
            row.addEventListener("click", () => {
                resultContainer.querySelectorAll(".main-analysis-row").forEach(r => r.classList.remove("active-row"));
                row.classList.add("active-row");

                const code = row.dataset.code;
                loadActiveStock(code);
            });
        });

        // Automatically load the first stock in the list on initial load
        if (!hasLoadedInitialStock && data.length > 0) {
            hasLoadedInitialStock = true;
            const firstStockCode = data[0].code;
            const firstRow = resultContainer.querySelector(".main-analysis-row");
            if (firstRow) firstRow.classList.add("active-row");
            loadActiveStock(firstStockCode);
        }
    };

    const exportToCSV = () => {
        if (mainAnalysisData.length === 0) {
            alert("다운로드할 데이터가 없습니다.");
            return;
        }

        const dates = [...new Set(mainAnalysisData.map(row => row.date))].sort((a, b) => b.localeCompare(a));
        const latestDate = dates[0];
        const latestDayData = mainAnalysisData.filter(row => row.date === latestDate);

        const refType = refSelect.value;
        const threshold = parseFloat(pctInput.value) || activeFilterPct;

        const filtered = latestDayData.filter(row => {
            const open = parseFloat(row.open_price) || 0;
            const high = parseFloat(row.high_price) || 0;
            const prevClose = parseFloat(row.prev_close_price) || 0;
            if (open <= 0 || prevClose <= 0) return false;
            let rate = 0;
            if (refType === "open") {
                rate = ((high - open) / open) * 100;
            } else {
                rate = ((high - prevClose) / prevClose) * 100;
            }
            return rate >= threshold;
        });

        if (filtered.length === 0) {
            alert("다운로드할 데이터가 없습니다.");
            return;
        }

        const headers = ["날짜", "종목코드", "종목명", "전일종가", "오늘시가", "오늘고가", "오늘종가", "시가대비고가비율(%)", "전일종가대비고가비율(%)", "오늘거래량"];
        
        const csvRows = [
            "\uFEFF" + headers.join(","),
            ...filtered.map(row => {
                const openToHigh = (((row.high_price - row.open_price) / row.open_price) * 100).toFixed(2);
                const closeToHigh = (((row.high_price - row.prev_close_price) / row.prev_close_price) * 100).toFixed(2);
                
                return [
                    row.date,
                    `"${row.code}"`,
                    `"${row.name.replace(/"/g, '""')}"`,
                    Math.round(row.prev_close_price),
                    Math.round(row.open_price),
                    Math.round(row.high_price),
                    Math.round(row.close_price),
                    openToHigh,
                    closeToHigh,
                    Math.round(row.volume)
                ].join(",");
            })
        ];

        const csvString = csvRows.join("\n");
        const blob = new Blob([csvString], { type: "text/csv;charset=utf-8;" });
        const link = document.createElement("a");
        const url = URL.createObjectURL(blob);
        
        link.setAttribute("href", url);
        link.setAttribute("download", `yesterday_gainers_today_flow_${latestDate}.csv`);
        link.style.visibility = "hidden";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    refSelect.addEventListener("change", applyFiltersAndRender);
    
    pctInput.addEventListener("input", () => {
        pctBtns.forEach(btn => btn.classList.remove("active"));
        applyFiltersAndRender();
    });

    pctBtns.forEach(btn => {
        btn.addEventListener("click", () => {
            pctBtns.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            activeFilterPct = parseFloat(btn.dataset.pct);
            pctInput.value = "";
            applyFiltersAndRender();
        });
    });

    exportBtn.addEventListener("click", exportToCSV);

    queryMainGainerResults();
};

// ==========================================
// 7. Core Initialization
// ==========================================
document.addEventListener("DOMContentLoaded", () => {
    lucide.createIcons();
    loadSettings();

    // Initialize date input to today's date
    const dateInput = document.getElementById("stock-search-date");
    if (dateInput) {
        const today = new Date();
        const yyyy = today.getFullYear();
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const dd = String(today.getDate()).padStart(2, '0');
        dateInput.value = `${yyyy}-${mm}-${dd}`;
    }

    renderQuickStocksList();
    initSearchBox();
    initNavigationTabs();
    initSchedulerMonitor();
    loadSchedulerStatus();
    initLimitUpsTab();
    initSearchTab();
    initMainAnalysisWidget();

    // Load daily limit up stocks list by default on startup (which initializes chart load)
    // Removed duplicate loadLimitUpStocks to let initMainAnalysisWidget handle first stock loading
});

// Resize handler to make the chart responsive
window.addEventListener("resize", () => {
    if (currentActiveStock && document.getElementById("tab-dashboard").style.display !== "none") {
        renderPriceChart(currentActiveStock);
    }
    if (currentSearchActiveStock && document.getElementById("tab-search").style.display !== "none") {
        renderSearchPriceChart(currentSearchActiveStock);
    }
});
