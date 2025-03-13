// Load holdings, crypto database, total investments, and wallets from localStorage (transactions are now on the server)
let holdings = JSON.parse(localStorage.getItem("holdings")) || {};
let cryptoDatabase = JSON.parse(localStorage.getItem("cryptoDatabase")) || [];
let totalInvestments = JSON.parse(localStorage.getItem("totalInvestments")) || [];
let wallets = JSON.parse(localStorage.getItem("wallets")) || [];
let isAdding = false;
let isRenderingDashboard = false;
let isGroupedView = false;
let isClosedPositionsExpanded = true; // Default to expanded state
let editingRow = null; // Track the row being edited

// Check if the user is authenticated
function checkAuth() {
    const token = localStorage.getItem('token');
    if (!token && window.location.pathname !== '/login.html') {
        window.location.href = '/login.html';
    }
}

// Fetch transactions from the server
async function getTransactions() {
    const token = localStorage.getItem('token');
    if (!token) {
        window.location.href = '/login.html';
        return [];
    }
    try {
        const response = await fetch('http://localhost:3000/transactions', {
            headers: { 'Authorization': 'Bearer ' + token }
        });
        if (response.ok) {
            return await response.json();
        } else {
            console.error('Failed to fetch transactions:', response.status);
            return [];
        }
    } catch (error) {
        console.error('Error fetching transactions:', error);
        return [];
    }
}

// Fetch prices and logos from CoinGecko by API ID
async function fetchCryptoData(apiIds) {
    console.log("Fetching data for API IDs:", apiIds);
    try {
        const ids = apiIds.join(",");
        const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${ids}`;
        console.log("CoinGecko URL:", url);

        const response = await fetch(url);
        if (!response.ok) throw new Error(`CoinGecko fetch failed: ${response.status}`);
        const data = await response.json();
        console.log("CoinGecko response data:", data);

        // Check for empty response
        if (data.length === 0) {
            console.error('No data returned from CoinGecko for IDs:', apiIds);
            // Return default data for all requested IDs to avoid breaking the dashboard
            return apiIds.reduce((acc, id) => ({
                ...acc,
                [id]: { symbol: id.toUpperCase(), price: 0, logo: "https://placehold.co/24x24" }
            }), {});
        }

        const cryptoData = {};
        data.forEach(coin => {
            const apiId = coin.id;
            cryptoData[apiId] = {
                symbol: coin.symbol.toUpperCase(),
                price: coin.current_price || 0,
                logo: coin.image || "https://placehold.co/24x24" // Updated to a reliable placeholder
            };
        });
        console.log("Processed crypto data:", cryptoData);
        return cryptoData;
    } catch (error) {
        console.error("Error fetching CoinGecko data:", error);
        return apiIds.reduce((acc, id) => ({
            ...acc,
            [id]: { symbol: id.toUpperCase(), price: 0, logo: "https://placehold.co/24x24" }
        }), {});
    }
}

// Initial load and navigation handling
document.addEventListener("DOMContentLoaded", () => {
    checkAuth(); // Ensure user is logged in
    console.log("DOM loaded, path:", window.location.pathname);
    holdings = JSON.parse(localStorage.getItem("holdings")) || {};
    cryptoDatabase = JSON.parse(localStorage.getItem("cryptoDatabase")) || [];
    totalInvestments = JSON.parse(localStorage.getItem("totalInvestments")) || [];
    wallets = JSON.parse(localStorage.getItem("wallets")) || [];
    console.log("Holdings reloaded from localStorage:", holdings);
    console.log("Crypto Database reloaded from localStorage:", cryptoDatabase);
    console.log("Total Investments reloaded from localStorage:", totalInvestments);
    console.log("Wallets reloaded from localStorage:", wallets);

    // Conditional toggleFields only for add-transaction.html
    if (window.location.pathname.includes("add-transaction")) {
        console.log("Initial load: add-transaction.html");
        const transactionType = document.getElementById("transactionType");
        if (transactionType) {
            transactionType.addEventListener("change", toggleFields);
            toggleFields(); // Initial call
        } else {
            console.warn("transactionType element not found on add-transaction.html");
        }
    } else if (window.location.pathname.includes("dashboard")) {
        console.log("Initial load: dashboard.html or /dashboard");
        ensureDashboardRender();
    } else if (window.location.pathname.includes("history")) {
        console.log("Initial load: history.html");
        renderTransactionHistory();
        const viewToggle = document.getElementById("viewToggle");
        if (viewToggle) {
            viewToggle.addEventListener("click", toggleHistoryView);
        } else {
            console.error("viewToggle not found in DOM");
        }
    } else if (window.location.pathname.includes("cash-invested")) {
        console.log("Initial load: cash-invested.html");
        renderInvestmentHistory();
    } else if (window.location.pathname.includes("wallets")) {
        console.log("Initial load: wallets.html, rendering tables...");
        renderMyWalletsTable();
        renderWalletTrackingTable();
        toggleWalletFields(); // Initial call to set visibility
    } else if (window.location.pathname.includes("crypto-inventory")) {
        console.log("Initial load: crypto-inventory.html, rendering table...");
        renderCryptoTable(); // Ensure table is rendered on load
    }

    // Fallback to render crypto table immediately after data load
    if (window.location.pathname.includes("crypto-inventory")) {
        renderCryptoTable(); // Additional safety net
    }
});

// Ensure dashboard renders
async function ensureDashboardRender() {
    const openTbody = document.getElementById("openHoldingsTable");
    const closedTbody = document.getElementById("closedHoldingsTable");
    const summaryTbody = document.getElementById("summaryTable");
    if (!openTbody || !closedTbody || !summaryTbody) {
        console.error("One or more tables not found, retrying in 100ms");
        setTimeout(ensureDashboardRender, 100);
        return;
    }
    await renderDashboard();
    console.log("Dashboard rendering ensured");
}

document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && window.location.pathname.includes("dashboard")) {
        console.log("Visibility changed to visible, ensuring dashboard render");
        ensureDashboardRender();
    }
});

async function addTransaction() {
    if (isAdding) {
        console.log("Already adding transaction—skipping duplicate call");
        return;
    }
    isAdding = true;
    console.log("addTransaction called");

    const date = document.getElementById("transactionDate").value;
    const type = document.getElementById("transactionType").value;
    const crypto = document.getElementById("cryptoName").value.toUpperCase();
    const cryptoFullName = document.getElementById("cryptoFullName").value.trim();
    const apiId = document.getElementById("apiId").value.trim().toLowerCase();
    const quantity = parseFloat(document.getElementById("quantity").value) || 0;
    const priceMethod = document.querySelector('input[name="priceMethod"]:checked').value;
    const priceInput = parseFloat(document.getElementById("price").value) || 0;
    const marketCap = parseFloat(document.getElementById("marketCap").value) || 0;
    const exchangeFrom = document.getElementById("exchangeFrom").value;
    const exchangeTo = document.getElementById("exchangeTo").value.trim();
    const walletAddress = document.getElementById("walletAddress").value;

    let price;
    if (type === "buy" && priceMethod === "marketCap") {
        if (!marketCap) {
            alert("Please enter a market cap for the buy transaction.");
            isAdding = false;
            return;
        }
        if (!quantity) {
            alert("Quantity must be greater than 0 to calculate price from market cap.");
            isAdding = false;
            return;
        }
        price = marketCap / quantity;
        console.log(`Calculated price from market cap: $${marketCap} / ${quantity} = $${price}`);
    } else {
        price = priceInput;
    }

    if (!date || !crypto || !cryptoFullName || !quantity || (type !== "transfer" && !price) || !walletAddress || (exchangeFrom.toLowerCase() === "coinbase" && !apiId)) {
        console.log("Validation failed:", { date, crypto, cryptoFullName, apiId, quantity, price, exchangeFrom, walletAddress });
        alert("Please fill in all required fields. API ID is required for Coinbase transactions.");
        isAdding = false;
        return;
    }

    const transaction = {
        type,
        crypto,
        cryptoFullName,
        apiId: apiId || crypto.toLowerCase(),
        amount: quantity,
        price,
        exchangeFrom,
        exchangeTo: type === "transfer" ? exchangeTo : "",
        walletAddress,
        date: new Date(date).toISOString()
    };

    const token = localStorage.getItem('token');
    if (!token) {
        window.location.href = '/login.html';
        isAdding = false;
        return;
    }

    try {
        const response = await fetch('http://localhost:3000/transactions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + token
            },
            body: JSON.stringify(transaction)
        });
        if (response.ok) {
            localStorage.setItem("refreshDashboard", Date.now().toString());
            document.getElementById("transaction-form").reset();
            // Ensure crypto is added to inventory if not already present (still using localStorage for now)
            const existingCrypto = cryptoDatabase.find(c => c.ticker === crypto);
            if (!existingCrypto) {
                const newCrypto = { ticker: crypto, name: cryptoFullName, apiId, category: "" };
                addCryptoToInventory(newCrypto);
            }
            window.location.href = "dashboard.html";
        } else {
            console.error('Failed to add transaction:', response.status);
            alert('Error adding transaction');
        }
    } catch (error) {
        console.error('Error adding transaction:', error);
        alert('Error adding transaction');
    }
    isAdding = false;
}

function updateHoldings(transactions) {
    console.log("updateHoldings called with transactions:", transactions);
    holdings = {};
    transactions.forEach((t, index) => {
        const { type, crypto, cryptoFullName, apiId, amount, price, walletAddress, exchangeTo } = t;
        if (!holdings[walletAddress]) holdings[walletAddress] = {};
        if (!holdings[walletAddress][apiId]) {
            holdings[walletAddress][apiId] = {
                crypto,
                cryptoFullName: cryptoFullName || crypto,
                lots: [],
                totalAmount: 0,
                totalCost: 0,
                closedPL: 0,
                soldQuantity: 0,
                soldCost: 0
            };
        }
        const walletCrypto = holdings[walletAddress][apiId];

        if (type === "buy") {
            walletCrypto.lots.push({ amount, costBasis: price });
            walletCrypto.totalAmount += amount;
            walletCrypto.totalCost += amount * price;
        } else if (type === "sell") {
            if (walletCrypto.totalAmount >= amount) {
                let remaining = amount;
                walletCrypto.lots.sort((a, b) => b.costBasis - a.costBasis); // LIFO
                while (remaining > 0 && walletCrypto.lots.length > 0) {
                    const lot = walletCrypto.lots[0];
                    const amountToSell = Math.min(remaining, lot.amount);
                    const pl = (price - lot.costBasis) * amountToSell;
                    walletCrypto.closedPL += pl;
                    walletCrypto.soldQuantity += amountToSell;
                    walletCrypto.soldCost += amountToSell * lot.costBasis;
                    lot.amount -= amountToSell;
                    walletCrypto.totalAmount -= amountToSell;
                    walletCrypto.totalCost -= amountToSell * lot.costBasis;
                    remaining -= amountToSell;
                    if (lot.amount <= 0) walletCrypto.lots.shift();
                }
            } else {
                console.warn(`Attempted to sell ${amount} of ${crypto}, but only ${walletCrypto.totalAmount} available.`);
            }
        } else if (type === "transfer") {
            if (walletCrypto.totalAmount >= amount) {
                let remaining = amount;
                walletCrypto.lots.sort((a, b) => b.costBasis - a.costBasis);
                const transferredLots = [];
                while (remaining > 0 && walletCrypto.lots.length > 0) {
                    const lot = walletCrypto.lots[0];
                    const amountToTransfer = Math.min(remaining, lot.amount);
                    transferredLots.push({ amount: amountToTransfer, costBasis: lot.costBasis });
                    lot.amount -= amountToTransfer;
                    walletCrypto.totalAmount -= amountToTransfer;
                    walletCrypto.totalCost -= amountToTransfer * lot.costBasis;
                    remaining -= amountToTransfer;
                    if (lot.amount <= 0) walletCrypto.lots.shift();
                }
                const destWallet = exchangeTo;
                if (destWallet) {
                    if (!holdings[destWallet]) holdings[destWallet] = {};
                    if (!holdings[destWallet][apiId]) {
                        holdings[destWallet][apiId] = { crypto, cryptoFullName: cryptoFullName || crypto, lots: [], totalAmount: 0, totalCost: 0, closedPL: 0, soldQuantity: 0, soldCost: 0 };
                    }
                    const destCrypto = holdings[destWallet][apiId];
                    transferredLots.forEach(lot => {
                        destCrypto.lots.push(lot);
                        destCrypto.totalAmount += lot.amount;
                        destCrypto.totalCost += lot.amount * lot.costBasis;
                    });
                }
            } else {
                console.warn(`Attempted to transfer ${amount} of ${crypto}, but only ${walletCrypto.totalAmount} available.`);
            }
        }
        console.log(`Updated holding for ${crypto} in ${walletAddress}: totalAmount=${walletCrypto.totalAmount}, closedPL=${walletCrypto.closedPL}`);
    });
    console.log("Holdings updated:", holdings);
    localStorage.setItem("holdings", JSON.stringify(holdings));
}

async function renderDashboard() {
    if (isRenderingDashboard) {
        console.log("Already rendering dashboard—skipping duplicate call");
        return;
    }
    isRenderingDashboard = true;
    console.log("renderDashboard called");

    const transactions = await getTransactions();
    updateHoldings(transactions);

    const openTbody = document.getElementById("openHoldingsTable");
    const closedTbody = document.getElementById("closedHoldingsTable");
    const summaryTbody = document.getElementById("summaryTable");
    openTbody.innerHTML = "";
    closedTbody.innerHTML = "";
    summaryTbody.innerHTML = "";

    let totalOpenValue = 0, totalOpenCost = 0, totalOpenPL = 0;
    let totalClosedPL = 0, totalSoldQuantity = 0, totalSoldCost = 0;

    const apiIds = [...new Set(Object.values(holdings).flatMap(w => Object.keys(w)))];
    const cryptoData = apiIds.length > 0 ? await fetchCryptoData(apiIds) : {};

    for (const walletAddress in holdings) {
        for (const apiId in holdings[walletAddress]) {
            const h = holdings[walletAddress][apiId];
            const cryptoInfo = cryptoData[apiId] || { price: 0, logo: "https://via.placeholder.com/24" };
            const currentValue = h.totalAmount * cryptoInfo.price;
            const openPL = currentValue - h.totalCost;
            const avgCost = h.totalAmount > 0 ? h.totalCost / h.totalAmount : 0;

            if (h.totalAmount > 0) {
                totalOpenValue += currentValue;
                totalOpenCost += h.totalCost;
                totalOpenPL += openPL;

                const row = document.createElement("tr");
                row.innerHTML = `
                    <td><img src="${cryptoInfo.logo}" alt="${h.crypto}" width="24" height="24"> ${h.cryptoFullName} (${h.crypto})</td>
                    <td>${walletAddress}</td>
                    <td>${h.totalAmount.toFixed(8)}</td>
                    <td>$${avgCost.toFixed(2)}</td>
                    <td>$${cryptoInfo.price.toFixed(2)}</td>
                    <td>$${currentValue.toFixed(2)}</td>
                    <td class="${openPL >= 0 ? "positive" : "negative"}">$${openPL.toFixed(2)}</td>
                `;
                openTbody.appendChild(row);
            }

            if (h.soldQuantity > 0) {
                totalClosedPL += h.closedPL;
                totalSoldQuantity += h.soldQuantity;
                totalSoldCost += h.soldCost;

                const closedRow = document.createElement("tr");
                closedRow.innerHTML = `
                    <td><img src="${cryptoInfo.logo}" alt="${h.crypto}" width="24" height="24"> ${h.cryptoFullName} (${h.crypto})</td>
                    <td>${walletAddress}</td>
                    <td>${h.soldQuantity.toFixed(8)}</td>
                    <td>$${h.soldCost.toFixed(2)}</td>
                    <td>$${(h.soldCost + h.closedPL).toFixed(2)}</td>
                    <td class="${h.closedPL >= 0 ? "positive" : "negative"}">$${h.closedPL.toFixed(2)}</td>
                `;
                closedTbody.appendChild(closedRow);
            }
        }
    }

    summaryTbody.innerHTML = `
        <tr>
            <td>$${totalOpenCost.toFixed(2)}</td>
            <td>$${totalOpenValue.toFixed(2)}</td>
            <td class="${totalOpenPL >= 0 ? "positive" : "negative"}">$${totalOpenPL.toFixed(2)}</td>
            <td>$${totalSoldCost.toFixed(2)}</td>
            <td>$${(totalSoldCost + totalClosedPL).toFixed(2)}</td>
            <td class="${totalClosedPL >= 0 ? "positive" : "negative"}">$${totalClosedPL.toFixed(2)}</td>
        </tr>
    `;

    document.getElementById("closedPositions").style.display = isClosedPositionsExpanded ? "block" : "none";
    isRenderingDashboard = false;
}

function toggleClosedPositions() {
    isClosedPositionsExpanded = !isClosedPositionsExpanded;
    const closedSection = document.getElementById("closedPositions");
    const toggleButton = document.getElementById("toggleClosedPositions");
    closedSection.style.display = isClosedPositionsExpanded ? "block" : "none";
    toggleButton.textContent = isClosedPositionsExpanded ? "Hide Closed Positions" : "Show Closed Positions";
}

async function renderTransactionHistory() {
    console.log("renderTransactionHistory called");
    const tbody = document.getElementById("transactionTableBody");
    const thead = document.getElementById("transactionTableHead");
    tbody.innerHTML = "";
    thead.innerHTML = "";

    const transactions = await getTransactions();
    if (!transactions.length) {
        tbody.innerHTML = "<tr><td colspan='8'>No transactions found.</td></tr>";
        return;
    }

    if (isGroupedView) {
        thead.innerHTML = `
            <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Crypto</th>
                <th>Amount</th>
                <th>Price</th>
                <th>From</th>
                <th>To</th>
                <th>Wallet</th>
            </tr>
        `;
        const grouped = transactions.reduce((acc, t) => {
            const key = `${t.date.split('T')[0]}-${t.crypto}-${t.type}`;
            if (!acc[key]) acc[key] = [];
            acc[key].push(t);
            return acc;
        }, {});

        for (const key in grouped) {
            const group = grouped[key];
            const first = group[0];
            const totalAmount = group.reduce((sum, t) => sum + t.amount, 0);
            const avgPrice = group.reduce((sum, t) => sum + t.price * t.amount, 0) / totalAmount;

            const row = document.createElement("tr");
            row.innerHTML = `
                <td>${new Date(first.date).toLocaleDateString()}</td>
                <td>${first.type}</td>
                <td>${first.cryptoFullName} (${first.crypto})</td>
                <td>${totalAmount.toFixed(8)}</td>
                <td>$${avgPrice.toFixed(2)}</td>
                <td>${first.exchangeFrom}</td>
                <td>${first.exchangeTo || '-'}</td>
                <td>${first.walletAddress}</td>
            `;
            tbody.appendChild(row);
        }
    } else {
        thead.innerHTML = `
            <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Crypto</th>
                <th>Amount</th>
                <th>Price</th>
                <th>From</th>
                <th>To</th>
                <th>Wallet</th>
                <th>Actions</th>
            </tr>
        `;
        transactions.forEach((t, index) => {
            const row = document.createElement("tr");
            row.innerHTML = `
                <td>${new Date(t.date).toLocaleDateString()}</td>
                <td>${t.type}</td>
                <td>${t.cryptoFullName} (${t.crypto})</td>
                <td>${t.amount.toFixed(8)}</td>
                <td>$${t.price.toFixed(2)}</td>
                <td>${t.exchangeFrom}</td>
                <td>${t.exchangeTo || '-'}</td>
                <td>${t.walletAddress}</td>
                <td>
                    <button onclick="editTransaction(${index})">Edit</button>
                    <button onclick="deleteTransaction(${index})">Delete</button>
                </td>
            `;
            tbody.appendChild(row);
        });
    }
    document.getElementById("viewToggle").textContent = isGroupedView ? "Switch to Detailed View" : "Switch to Grouped View";
}

function toggleHistoryView() {
    isGroupedView = !isGroupedView;
    renderTransactionHistory();
}

function editTransaction(index) {
    // TODO: Implement PUT request to server when endpoint is available
    console.log("editTransaction called for index:", index);
    // For now, this needs server-side PUT /transactions/:id support
}

function deleteTransaction(index) {
    // TODO: Implement DELETE request to server when endpoint is available
    console.log("deleteTransaction called for index:", index);
    // For now, this needs server-side DELETE /transactions/:id support
}

function toggleFields() {
    console.log("toggleFields called");
    const type = document.getElementById("transactionType").value;
    const priceFields = document.getElementById("priceFields");
    const marketCapField = document.getElementById("marketCapField");
    const exchangeToField = document.getElementById("exchangeToField");

    priceFields.style.display = type === "transfer" ? "none" : "block";
    marketCapField.style.display = type === "buy" ? "block" : "none";
    exchangeToField.style.display = type === "transfer" ? "block" : "none";
}

function addCryptoToInventory(crypto) {
    console.log("Adding crypto to inventory:", crypto);
    cryptoDatabase.push(crypto);
    localStorage.setItem("cryptoDatabase", JSON.stringify(cryptoDatabase));
    renderCryptoTable();
}

function renderCryptoTable() {
    console.log("renderCryptoTable called");
    const tbody = document.getElementById("cryptoTableBody");
    if (!tbody) {
        console.error("cryptoTableBody not found in DOM");
        return;
    }
    tbody.innerHTML = "";

    if (!cryptoDatabase.length) {
        tbody.innerHTML = "<tr><td colspan='5'>No cryptocurrencies added yet.</td></tr>";
        return;
    }

    cryptoDatabase.forEach((crypto, index) => {
        const row = document.createElement("tr");
        row.innerHTML = `
            <td>${crypto.ticker}</td>
            <td>${crypto.name}</td>
            <td>${crypto.apiId}</td>
            <td>${crypto.category || ''}</td>
            <td>
                <button onclick="editCrypto(${index})">Edit</button>
                <button onclick="deleteCrypto(${index})">Delete</button>
            </td>
        `;
        tbody.appendChild(row);
    });
}

function editCrypto(index) {
    console.log("editCrypto called for index:", index);
    const crypto = cryptoDatabase[index];
    document.getElementById("ticker").value = crypto.ticker;
    document.getElementById("name").value = crypto.name;
    document.getElementById("apiId").value = crypto.apiId;
    document.getElementById("category").value = crypto.category || '';
    editingRow = index;
}

function deleteCrypto(index) {
    console.log("deleteCrypto called for index:", index);
    cryptoDatabase.splice(index, 1);
    localStorage.setItem("cryptoDatabase", JSON.stringify(cryptoDatabase));
    renderCryptoTable();
}

function saveCrypto() {
    console.log("saveCrypto called");
    const ticker = document.getElementById("ticker").value.toUpperCase();
    const name = document.getElementById("name").value;
    const apiId = document.getElementById("apiId").value.toLowerCase();
    const category = document.getElementById("category").value;

    if (!ticker || !name || !apiId) {
        alert("Please fill in all required fields (Ticker, Name, API ID).");
        return;
    }

    const crypto = { ticker, name, apiId, category };
    if (editingRow !== null) {
        cryptoDatabase[editingRow] = crypto;
        editingRow = null;
    } else {
        cryptoDatabase.push(crypto);
    }
    localStorage.setItem("cryptoDatabase", JSON.stringify(cryptoDatabase));
    document.getElementById("crypto-form").reset();
    renderCryptoTable();
}

function renderInvestmentHistory() {
    console.log("renderInvestmentHistory called");
    const tbody = document.getElementById("investmentTableBody");
    tbody.innerHTML = "";

    if (!totalInvestments.length) {
        tbody.innerHTML = "<tr><td colspan='5'>No investment history available.</td></tr>";
        return;
    }

    totalInvestments.forEach((investment, index) => {
        const row = document.createElement("tr");
        row.innerHTML = `
            <td>${investment.date}</td>
            <td>${investment.type}</td>
            <td>$${investment.amount.toFixed(2)}</td>
            <td>${investment.exchange}</td>
            <td><button onclick="deleteInvestment(${index})">Delete</button></td>
        `;
        tbody.appendChild(row);
    });
}

function deleteInvestment(index) {
    console.log("deleteInvestment called for index:", index);
    totalInvestments.splice(index, 1);
    localStorage.setItem("totalInvestments", JSON.stringify(totalInvestments));
    renderInvestmentHistory();
}

function saveInvestment() {
    console.log("saveInvestment called");
    const date = document.getElementById("investmentDate").value;
    const type = document.getElementById("investmentType").value;
    const amount = parseFloat(document.getElementById("investmentAmount").value) || 0;
    const exchange = document.getElementById("investmentExchange").value;

    if (!date || !amount || !exchange) {
        alert("Please fill in all fields.");
        return;
    }

    totalInvestments.push({ date, type, amount, exchange });
    localStorage.setItem("totalInvestments", JSON.stringify(totalInvestments));
    document.getElementById("investment-form").reset();
    renderInvestmentHistory();
}

function renderMyWalletsTable() {
    console.log("renderMyWalletsTable called");
    const tbody = document.getElementById("myWalletsTableBody");
    tbody.innerHTML = "";

    if (!wallets.length) {
        tbody.innerHTML = "<tr><td colspan='5'>No wallets added yet.</td></tr>";
        return;
    }

    wallets.forEach((wallet, index) => {
        const row = document.createElement("tr");
        row.innerHTML = `
            <td>${wallet.name}</td>
            <td>${wallet.address}</td>
            <td>${wallet.type}</td>
            <td>${wallet.network}</td>
            <td>
                <button onclick="editWallet(${index})">Edit</button>
                <button onclick="deleteWallet(${index})">Delete</button>
            </td>
        `;
        tbody.appendChild(row);
    });
}

function renderWalletTrackingTable() {
    console.log("renderWalletTrackingTable called");
    const tbody = document.getElementById("walletTrackingTableBody");
    tbody.innerHTML = "<tr><td colspan='4'>Wallet tracking not implemented yet.</td></tr>";
}

function editWallet(index) {
    console.log("editWallet called for index:", index);
    const wallet = wallets[index];
    document.getElementById("walletName").value = wallet.name;
    document.getElementById("walletAddress").value = wallet.address;
    document.getElementById("walletType").value = wallet.type;
    document.getElementById("network").value = wallet.network;
    editingRow = index;
}

function deleteWallet(index) {
    console.log("deleteWallet called for index:", index);
    wallets.splice(index, 1);
    localStorage.setItem("wallets", JSON.stringify(wallets));
    renderMyWalletsTable();
}

function saveWallet() {
    console.log("saveWallet called");
    const name = document.getElementById("walletName").value;
    const address = document.getElementById("walletAddress").value;
    const type = document.getElementById("walletType").value;
    const network = document.getElementById("network").value;

    if (!name || !address || !type || !network) {
        alert("Please fill in all fields.");
        return;
    }

    const wallet = { name, address, type, network };
    if (editingRow !== null) {
        wallets[editingRow] = wallet;
        editingRow = null;
    } else {
        wallets.push(wallet);
    }
    localStorage.setItem("wallets", JSON.stringify(wallets));
    document.getElementById("wallet-form").reset();
    renderMyWalletsTable();
}

function toggleWalletFields() {
    console.log("toggleWalletFields called");
    const type = document.getElementById("walletType").value;
    const networkField = document.getElementById("networkField");
    networkField.style.display = type === "hardware" ? "none" : "block";
}