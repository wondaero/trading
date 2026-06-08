// ==========================================
// 1. Settings & API Management
// ==========================================
const DEFAULT_SETTINGS = {
  apiUrl: "https://uncffkzyvaapanixvniy.supabase.co/functions/v1/korea-invest-proxy",
  anonKey: ""
};

let appSettings = { ...DEFAULT_SETTINGS };

// Load settings from localStorage
const loadSettings = () => {
  const stored = localStorage.getItem("trading_api_settings");
  if (stored) {
    try {
      appSettings = { ...DEFAULT_SETTINGS, ...JSON.parse(stored) };
    } catch (e) {
      console.error("Failed to parse settings", e);
    }
  }
};

// Save settings to localStorage
const saveSettings = (newSettings) => {
  appSettings = { ...appSettings, ...newSettings };
  localStorage.setItem("trading_api_settings", JSON.stringify(appSettings));
};

// Normalizes API response from Supabase Edge Function to StockInfo
const adaptKoreaInvestData = (code, raw) => {
  const info = raw.stockInfo;
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

  // Build GET URL with query parameter code
  const separator = url.includes("?") ? "&" : "?";
  const fetchUrl = `${url}${separator}code=${code}`;

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
const renderQuickStocksList = () => {
  const listContainer = document.getElementById("quick-stocks-list");
  if (!listContainer) return;

  const popularStocks = [
    { code: "005930", name: "삼성전자" },
    { code: "000660", name: "SK하이닉스" },
    { code: "035420", name: "NAVER" },
    { code: "035720", name: "카카오" }
  ];
  
  listContainer.innerHTML = popularStocks.map(stock => `
    <div class="quick-stock-item" data-code="${stock.code}" id="quick-item-${stock.code}">
      <div class="quick-info-left">
        <span class="quick-name">${stock.name}</span>
        <span class="quick-code">${stock.code}</span>
      </div>
      <div class="quick-info-right">
        <span class="quick-price" style="font-size:0.75rem; color:var(--text-dimmed);">조회하기</span>
      </div>
    </div>
  `).join("");

  // Attach click handlers
  listContainer.querySelectorAll(".quick-stock-item").forEach(item => {
    item.addEventListener("click", () => {
      const code = item.dataset.code;
      loadActiveStock(code);
    });
  });
};

const updateQuickListActiveState = (activeCode) => {
  const container = document.getElementById("quick-stocks-list");
  if (!container) return;

  container.querySelectorAll(".quick-stock-item").forEach(item => {
    if (item.dataset.code === activeCode) {
      item.classList.add("active");
    } else {
      item.classList.remove("active");
    }
  });
};

const initSearchBox = () => {
  const searchInput = document.getElementById("stock-search-input");
  if (!searchInput) return;

  // Search on pressing Enter
  searchInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const val = searchInput.value.trim();
      if (!val) return;
      
      // Regular code format check
      if (val.length === 6 && !isNaN(val)) {
        loadActiveStock(val);
      } else {
        alert("올바른 종목 코드 6자리를 입력해주세요. (예: 005930)");
      }
      searchInput.value = "";
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
      
      // Force SVG chart redraw when returning to dashboard
      if (tabId === "dashboard" && currentActiveStock) {
        setTimeout(() => renderPriceChart(currentActiveStock), 50);
      }
    });
  });
};

// ==========================================
// 6. Settings Modal Configuration
// ==========================================
const initSettingsModal = () => {
  const openBtn = document.getElementById("open-settings-btn");
  const closeBtn = document.getElementById("close-modal-btn");
  const cancelBtn = document.getElementById("cancel-settings-btn");
  const saveBtn = document.getElementById("save-settings-btn");
  const modalOverlay = document.getElementById("settings-modal");
  
  const urlInput = document.getElementById("settings-url-input");
  const keyInput = document.getElementById("settings-key-input");

  if (!openBtn || !modalOverlay) return;

  // Open modal and load current fields
  openBtn.addEventListener("click", () => {
    urlInput.value = appSettings.apiUrl;
    keyInput.value = appSettings.anonKey;
    modalOverlay.classList.add("active");
  });

  const closeModal = () => {
    modalOverlay.classList.remove("active");
  };

  closeBtn.addEventListener("click", closeModal);
  cancelBtn.addEventListener("click", closeModal);
  modalOverlay.addEventListener("click", (e) => {
    if (e.target === modalOverlay) closeModal();
  });

  // Save Config Fields
  saveBtn.addEventListener("click", () => {
    const apiUrl = urlInput.value.trim();
    const anonKey = keyInput.value.trim();

    if (!apiUrl) {
      alert("API 프록시 URL은 필수 항목입니다.");
      return;
    }

    saveSettings({ apiUrl, anonKey });
    closeModal();
    
    // Reload currently active stock under new configuration settings
    if (currentActiveStock) {
      loadActiveStock(currentActiveStock.code);
    }
  });
};

// ==========================================
// 7. Core Initialization
// ==========================================
document.addEventListener("DOMContentLoaded", () => {
  lucide.createIcons();
  loadSettings();
  renderQuickStocksList();
  initSearchBox();
  initNavigationTabs();
  initSettingsModal();

  // Load Samsung Electronics by default (005930)
  loadActiveStock("005930");
});

// Resize handler to make the chart responsive
window.addEventListener("resize", () => {
  if (currentActiveStock && document.getElementById("tab-dashboard").style.display !== "none") {
    renderPriceChart(currentActiveStock);
  }
});
