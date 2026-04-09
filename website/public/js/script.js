  document.addEventListener('DOMContentLoaded', () => {
  const sections = document.querySelectorAll('.content');
  const SERVER_ID = '1014872741846974514'; // Hardcoded Discord server ID
  const SECTION_HASHES = {
    landingPage: 'home',
    giveawayList: 'giveaways',
    rafflesSection: 'raffles',
    shop: 'shop',
    dailyTasksPage: 'auto-quests',
    jobList: 'quests',
    robotOilSection: 'robot-oil',
    leaderboard: 'leaderboard',
    adminList: 'admin-list',
    consoleSection: 'logs',
    inventorySection: 'inventory',
    mapSection: 'map',
    userProfileSection: 'profile',
    chatSection: 'chat',
    adminPage: 'admin',
  };
  const ADMIN_PANEL_HASHES = {
    adminSubmissionsPanel: 'quest-submissions',
    adminUserPanel: 'users',
    adminTitleGiveawaysPanel: 'title-giveaways',
    adminGiveawaysPanel: 'giveaways',
    adminRafflesPanel: 'raffles',
    adminJoblistPanel: 'quest-list',
    adminShopItemsPanel: 'shop-items',
    adminRedemptionsPanel: 'item-redemptions',
    adminCallAttendancePanel: 'call-attendance',
  };
  const HASH_TO_SECTION = Object.fromEntries(
    Object.entries(SECTION_HASHES).map(([sectionId, hashName]) => [hashName, sectionId])
  );
  const HASH_TO_ADMIN_PANEL = Object.fromEntries(
    Object.entries(ADMIN_PANEL_HASHES).map(([panelId, hashName]) => [hashName, panelId])
  );
  const ADMIN_ROUTE_SECTION = 'adminPage';
  const DEFAULT_ADMIN_PANEL = 'adminSubmissionsPanel';
  const AUTH_REQUIRED_SECTIONS = new Set(['userProfileSection', 'inventorySection', 'mapSection']);
  let cachedAdminStatus = null;
  let adminStatusPromise = null;

  function getAuthToken() {
    return localStorage.getItem('token') || '';
  }

  function isLoggedIn() {
    return Boolean(getAuthToken());
  }

  function getAuthHeaders(extraHeaders = {}) {
    const token = getAuthToken();
    return token
      ? { ...extraHeaders, Authorization: `Bearer ${token}` }
      : { ...extraHeaders };
  }

  function routeToPathname(sectionId, routePath = null) {
    if (sectionId === 'userProfileSection' && routePath) {
      if (routePath.startsWith('username/')) {
        return `/${routePath.slice('username/'.length)}`;
      }
      return `/${routePath}`;
    }
    if (sectionId === 'inventorySection') {
      if (!routePath) return '/inventory';
      if (routePath.startsWith('username/')) {
        return `/inventory/${routePath.slice('username/'.length)}`;
      }
      return `/inventory/${routePath}`;
    }
    return '/';
  }

  function normalizeProfileRouteParts(routeParts) {
    const cleanParts = (routeParts || []).filter(Boolean);
    if (!cleanParts.length) return [];
    if (['wallet', 'twitter', 'username'].includes(cleanParts[0])) {
      return cleanParts;
    }
    if (cleanParts.length === 1 && /^\d{15,25}$/.test(cleanParts[0])) {
      return cleanParts;
    }
    return ['username', ...cleanParts];
  }

  function buildUsernameRoutePath(username, fallbackUserId = null) {
    const normalizedUsername = String(username || '').trim();
    if (normalizedUsername) {
      return `username/${encodeURIComponent(normalizedUsername)}`;
    }

    const normalizedUserId = String(fallbackUserId || '').trim();
    return normalizedUserId ? encodeURIComponent(normalizedUserId) : null;
  }

  function getPathRouteState() {
    const pathParts = window.location.pathname
      .split('/')
      .map((part) => part.trim())
      .filter(Boolean);

    if (!pathParts.length) return null;
    if (pathParts[0] === 'inventory') {
      return {
        sectionId: 'inventorySection',
        routeParts: normalizeProfileRouteParts(pathParts.slice(1)),
      };
    }

    return {
      sectionId: 'userProfileSection',
      routeParts: normalizeProfileRouteParts(pathParts),
    };
  }

  function setSectionHash(sectionId, adminPanelId = null, profileRoutePath = null) {
    if (sectionId === 'landingPage') {
      if (window.location.pathname !== '/' || window.location.hash) {
        window.history.replaceState(null, '', `/${window.location.search}`);
      }
      return;
    }

    if (sectionId === 'userProfileSection' || sectionId === 'inventorySection') {
      const nextPath = routeToPathname(sectionId, profileRoutePath);
      const nextUrl = `${nextPath}${window.location.search}`;
      if (window.location.pathname !== nextPath || window.location.hash) {
        window.history.replaceState(null, '', nextUrl);
      }
      return;
    }

    const routeName = SECTION_HASHES[sectionId] || SECTION_HASHES.landingPage;
    let nextHash = `#${routeName}`;
    if (sectionId === ADMIN_ROUTE_SECTION && adminPanelId && ADMIN_PANEL_HASHES[adminPanelId]) {
      nextHash = `#${routeName}/${ADMIN_PANEL_HASHES[adminPanelId]}`;
    } else if (sectionId === 'userProfileSection' && profileRoutePath) {
      nextHash = `#${routeName}/${profileRoutePath}`;
    }
    const nextUrl = `/${window.location.search}${nextHash}`;
    if (window.location.pathname !== '/' || window.location.hash !== nextHash) {
      window.history.replaceState(null, '', nextUrl);
    }
  }

  function hideAdminPanels() {
    document.querySelectorAll('.admin-panel').forEach((panel) => {
      panel.style.display = 'none';
    });
    document.querySelectorAll('.admin-toggle').forEach((button) => {
      button.style.display = 'inline-block';
    });
  }

  function getActiveAdminPanelId() {
    return Array.from(document.querySelectorAll('.admin-panel'))
      .find((panel) => panel.style.display === 'block')?.id || DEFAULT_ADMIN_PANEL;
  }

  // Show one section, hide all others
  function showSection(sectionId, options = {}) {
    let safeSectionId = document.getElementById(sectionId) ? sectionId : 'landingPage';
    if (AUTH_REQUIRED_SECTIONS.has(safeSectionId) && !isLoggedIn()) {
      safeSectionId = 'landingPage';
    }
    if (safeSectionId !== 'mapSection' && isMemberMapFullscreenActive()) {
      exitMemberMapFullscreen();
    }
    sections.forEach((section) => {
      section.style.display = 'none';
    });
    const sectionToShow = document.getElementById(safeSectionId);
    if (sectionToShow) {
      sectionToShow.style.display = 'block';
    }
    if (safeSectionId !== ADMIN_ROUTE_SECTION) {
      hideAdminPanels();
    }
    if (options.updateHash !== false) {
      const activeAdminPanel = safeSectionId === ADMIN_ROUTE_SECTION
        ? options.adminPanelId || getActiveAdminPanelId()
        : null;
      const profileRoutePath = safeSectionId === 'userProfileSection'
        ? options.profileRoutePath ||
          currentProfileRoutePath ||
          encodeURIComponent(options.profileUserId || currentProfileUserId || localStorage.getItem('discordUserID') || '')
        : safeSectionId === 'inventorySection'
          ? options.inventoryRoutePath || currentInventoryRoutePath || ''
        : null;
      setSectionHash(safeSectionId, activeAdminPanel, profileRoutePath);
    }
  }

  async function checkCurrentUserIsAdmin() {
    const token = localStorage.getItem('token');
    if (!token) {
      cachedAdminStatus = false;
      return false;
    }
    if (cachedAdminStatus !== null) return cachedAdminStatus;
    if (!adminStatusPromise) {
      adminStatusPromise = fetch('/api/admin/check', {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then((response) => response.ok ? response.json() : { isAdmin: false })
        .then((data) => Boolean(data?.isAdmin))
        .catch((error) => {
          console.error('❌ Failed to check admin status:', error);
          return false;
        })
        .finally(() => {
          adminStatusPromise = null;
        });
    }
    cachedAdminStatus = await adminStatusPromise;
    return cachedAdminStatus;
  }

  function loadAdminPanelData(targetId) {
    if (targetId === 'adminSubmissionsPanel') loadAdminPage();
    if (targetId === 'adminUserPanel') loadAdminUsers();
    if (targetId === 'adminTitleGiveawaysPanel') loadAdminTitleGiveaways();
    if (targetId === 'adminGiveawaysPanel') loadAdminGiveaways();
    if (targetId === 'adminRafflesPanel') loadAdminRaffles();
    if (targetId === 'adminJoblistPanel') loadAdminJoblist();
    if (targetId === 'adminRedemptionsPanel') loadAdminRedemptions();
    if (targetId === 'adminShopItemsPanel') loadAdminShopItems();
    if (targetId === 'adminCallAttendancePanel') loadAdminCallAttendance();
  }

  async function openAdminSection(targetPanelId = DEFAULT_ADMIN_PANEL, options = {}) {
    const isAdmin = await checkCurrentUserIsAdmin();
    if (!isAdmin) {
      showSection('landingPage');
      return false;
    }

    const panelId = document.getElementById(targetPanelId) ? targetPanelId : DEFAULT_ADMIN_PANEL;
    showSection(ADMIN_ROUTE_SECTION, { updateHash: false });
    hideAdminPanels();

    const panel = document.getElementById(panelId);
    const toggleButton = document.querySelector(`.admin-toggle[data-target="${panelId}"]`);
    if (panel) panel.style.display = 'block';
    if (toggleButton) toggleButton.style.display = 'none';
    loadAdminPanelData(panelId);

    if (options.updateHash !== false) {
      setSectionHash(ADMIN_ROUTE_SECTION, panelId);
    }
    return true;
  }

  // Format data depending on the endpoint type
  function getFormatter(type) {
    const formatters = {
      leaderboard: (item) =>
        `User: ${item.userTag} | Wallet: ${item.wallet} | Battery Bank: ${item.bank} | Total: ${item.totalBalance}`,
      admins: (item) => `Admin: ${item.userTag}`,
      shop: (item) =>
        `[${item.id}] ${item.name} - ${item.price} | Qty: ${item.quantity ?? 'N/A'} | Desc: ${item.description ?? ''}`,
      jobs: (job) => `[${job.jobID}] ${job.description}`,
      giveaways: (item) =>
        `Giveaway #${item.id} — Prize: "${item.prize}" — Ends: ${item.end_time ? new Date(item.end_time).toLocaleString() : 'N/A'}`,
    };
    return formatters[type] || ((obj) => JSON.stringify(obj));
  }

  // Generic fetch function
  async function fetchData(url, targetElement, type) {
    if (!targetElement) {
      console.error(`Target element is null for URL: ${url}`);
      return;
    }
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch from ${url}: ${response.statusText}`);
      }
      const data = await response.json();
      if (!Array.isArray(data) || data.length === 0) {
        targetElement.innerHTML = '<li>No data available.</li>';
        return;
      }
      const formatter = getFormatter(type);
      targetElement.innerHTML = data.map((item) => `<li>${formatter(item)}</li>`).join('');
    } catch (error) {
      console.error(`Error fetching data from ${url}:`, error);
      targetElement.innerHTML = '<li>Error loading data.</li>';
    }
  }

// ------------------------------
// Leaderboard Section (Clickable to view user's inventory)
// ------------------------------
const showLeaderboardButton = document.getElementById('showLeaderboardButton');
if (showLeaderboardButton) {
  showLeaderboardButton.addEventListener('click', () => {
    const leaderboardList = document.getElementById('leaderboardList');
    fetch('/api/leaderboard')
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        return response.json();
      })
      .then((leaderboard) => {
        leaderboardList.innerHTML = '';
        leaderboard.forEach((entry, index) => {
          const item = document.createElement('div');
          item.className = 'leaderboard-item';
          item.style.cursor = 'pointer'; // Indicates that the item is clickable

          // When clicked, fetch and display the profile for that user
          item.addEventListener('click', () => {
            fetchUserHoldingsFor(entry.userID);
            if (typeof showSection === 'function') {
              showSection('userProfileSection', { profileUserId: entry.userID });
            }
          });

          // Create the content for this leaderboard entry
          const totalBalance = entry.wallet + entry.bank;
          item.innerHTML = `
            <span class="rank">${index + 1}. </span>
            <span class="user-tag">${entry.userTag}</span> 
            <span class="details">
              Solarian: ${entry.wallet} | Battery Bank: ${entry.bank} | Total: ${totalBalance}
            </span>
          `;
          leaderboardList.appendChild(item);
        });
      })
      .catch((error) => {
        console.error('Error fetching leaderboard:', error);
        leaderboardList.textContent = 'Failed to load leaderboard.';
      });
    showSection('leaderboard');
  });
}

/**
 * Fetches and displays the inventory for the given user.
 * Assumes there is an API endpoint at `/api/public-inventory/<userID>` that returns an array of items.
 * @param {string} userID - The ID of the user whose inventory should be shown.
 */
async function fetchUserInventory(userID, routePath = null) {
  try {
    const localUserId = localStorage.getItem('discordUserID');
    currentInventoryRoutePath = routePath || (userID ? encodeURIComponent(userID) : null);
    currentProfileUserId = userID || null;
    if (routePath) currentProfileRoutePath = routePath;
    const nameLabel = currentProfileUsername || userID;
    if (userID && localUserId && userID !== localUserId) {
      setInventoryHeader(nameLabel, true, userID);
    } else {
      const selfName = localStorage.getItem('username');
      setInventoryHeader(selfName, false, localUserId);
    }

    const response = await fetch(`/api/public-inventory/${userID}`, {
      headers: getAuthHeaders(),
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch inventory for user ${userID}`);
    }
    const data = await response.json();
    const inventoryItems = document.getElementById('inventoryItems');
    inventoryItems.innerHTML = '';

    if (!data.length) {
      inventoryItems.innerHTML = `<p class="no-items text-body">No items in this user's inventory.</p>`;
    } else {
      data.forEach((item) => {
        const itemContainer = document.createElement('div');
        itemContainer.className = 'inventory-item raffle-item bg-content border border-accent rounded-lg p-3 my-2 shadow-md text-primary';

        itemContainer.innerHTML = `
          <h3 class="font-bold text-highlight uppercase tracking-wide text-center">${item.name} (Qty: ${item.quantity})</h3>
          <p class="text-body text-primary">${item.description}</p>
        `;

        inventoryItems.appendChild(itemContainer);
      });
    }
    showSection('inventorySection', { inventoryRoutePath: currentInventoryRoutePath });
  } catch (error) {
    console.error('Error fetching user inventory:', error);
    alert('Failed to load user inventory.');
  }
}

async function fetchUserInventoryByProfileRoute(routePath) {
  const cleanRoutePath = String(routePath || '').trim();
  if (!cleanRoutePath) {
    fetchInventory();
    showSection('inventorySection', { inventoryRoutePath: '' });
    return;
  }

  if (!cleanRoutePath.includes('/')) {
    if (/^\d{15,25}$/.test(cleanRoutePath)) {
      fetchUserInventory(cleanRoutePath, encodeURIComponent(cleanRoutePath));
      return;
    }
    fetchUserInventoryByUsername(cleanRoutePath);
    return;
  }

  const [routeType, ...routeTail] = cleanRoutePath.split('/');
  const routeValue = decodeURIComponent(routeTail.join('/'));

  if (routeType === 'wallet' && routeValue) {
    fetchUserInventoryByWallet(routeValue);
  } else if (routeType === 'twitter' && routeValue) {
    fetchUserInventoryByTwitter(routeValue);
  } else if (routeType === 'username' && routeValue) {
    fetchUserInventoryByUsername(routeValue);
  } else if (routeType) {
    fetchUserInventory(decodeURIComponent(cleanRoutePath), cleanRoutePath);
  } else {
    fetchInventory();
    showSection('inventorySection', { inventoryRoutePath: '' });
  }
}

async function fetchUserInventoryByHolderRoute(fetchUrl, routePath, fallbackLabel) {
  try {
    const holderRes = await fetch(fetchUrl, {
      headers: getAuthHeaders(),
    });
    if (!holderRes.ok) throw new Error(`Failed to fetch holder route: ${fetchUrl}`);
    const holder = await holderRes.json();
    if (!holder?.discordId) {
      showSection('inventorySection', { inventoryRoutePath: routePath });
      const inventoryItems = document.getElementById('inventoryItems');
      if (inventoryItems) {
        inventoryItems.innerHTML = `<p class="no-items text-body">No inventory found for ${escapeHtml(fallbackLabel)}.</p>`;
      }
      return;
    }
    currentProfileUsername = holder.username || fallbackLabel || holder.twitterHandle || holder.walletAddress || holder.discordId;
    fetchUserInventory(String(holder.discordId), routePath);
  } catch (error) {
    console.error('Error fetching user inventory by route:', error);
    alert('Failed to load user inventory.');
  }
}

async function fetchUserInventoryByUsername(username) {
  const normalizedUsername = String(username || '').trim();
  if (!normalizedUsername) return;
  return fetchUserInventoryByHolderRoute(
    `/api/holder/username/${encodeURIComponent(normalizedUsername)}`,
    `username/${encodeURIComponent(normalizedUsername)}`,
    normalizedUsername
  );
}

async function fetchUserInventoryByWallet(walletAddress) {
  const normalizedWallet = String(walletAddress || '').trim();
  if (!normalizedWallet) return;
  return fetchUserInventoryByHolderRoute(
    `/api/holder/wallet/${encodeURIComponent(normalizedWallet)}`,
    `wallet/${encodeURIComponent(normalizedWallet)}`,
    normalizedWallet
  );
}

async function fetchUserInventoryByTwitter(twitterHandle) {
  const normalizedHandle = String(twitterHandle || '').trim().replace(/^@+/, '');
  if (!normalizedHandle) return;
  return fetchUserInventoryByHolderRoute(
    `/api/holder/twitter/${encodeURIComponent(normalizedHandle)}`,
    `twitter/${encodeURIComponent(normalizedHandle)}`,
    `@${normalizedHandle}`
  );
}


  // ------------------------------
  // Admin List Section
  // ------------------------------
  const showAdminListButton = document.getElementById('showAdminListButton');
  if (showAdminListButton) {
    showAdminListButton.addEventListener('click', () => {
      const adminListContent = document.getElementById('adminListContent');
      fetch('/api/admins')
        .then((response) => response.json())
        .then((admins) => {
          adminListContent.innerHTML = '';
          admins.forEach((admin) => {
            const adminLink = document.createElement('a');
            adminLink.href = `https://discord.com/users/${admin.userID}`;
            adminLink.target = '_blank';
            adminLink.textContent = admin.userTag;
            const listItem = document.createElement('div');
            listItem.className = 'admin-item';
            listItem.innerHTML = `<span>Admin:</span> `;
            listItem.appendChild(adminLink);
            adminListContent.appendChild(listItem);
          });
        })
        .catch((error) => {
          console.error('Error fetching admin list:', error);
          adminListContent.textContent = 'Failed to load admin list.';
        });
      showSection('adminList');
    });
  }

// ==================
  // SHOP SECTION - BUY ITEMS (With Modal)
const showShopButton = document.getElementById('showShopButton');
if (showShopButton) {
  showShopButton.addEventListener('click', async () => {
    let shopItems = document.getElementById('shopItems');
    if (!shopItems) {
      shopItems = document.createElement('div');
      shopItems.id = 'shopItems';
      shopItems.className = 'shop-list';
      document.body.appendChild(shopItems);
    }
    try {
      const response = await fetch('/api/shop');
      const data = await response.json();
      shopItems.innerHTML = ''; // Clear existing content

      data.forEach((item) => {
        const itemContainer = document.createElement('div');
        itemContainer.className = 'shop-item';
        itemContainer.style.cursor = 'pointer';

        const detailsSpan = document.createElement('span');
        detailsSpan.innerHTML = `<strong>${item.name}</strong> - ⚡${item.price} | Qty: ${item.quantity}`;
        itemContainer.appendChild(detailsSpan);

        const descriptionSpan = document.createElement('p');
        descriptionSpan.innerHTML = item.description.replace(
          /\[([^\]]+)\]\(([^)]+)\)/g,
          '<a href="$2" target="_blank" class="link">$1</a>'
        );
        itemContainer.appendChild(descriptionSpan);

        // Buy event listener - triggers modal
        itemContainer.addEventListener('click', () => {
          showPurchaseModal(item);
        });

        shopItems.appendChild(itemContainer);
      });

      showSection('shop');
    } catch (error) {
      console.error('Error fetching shop data:', error);
    }
  });
}

/**
 * Show purchase confirmation modal.
 * @param {Object} item - The item being purchased.
 */
function showPurchaseModal(item) {
  const existingModal = document.getElementById('purchaseModal');
  if (existingModal) existingModal.remove(); // Remove existing modal if any

  // Create modal overlay
  const modalOverlay = document.createElement('div');
  modalOverlay.className = 'modal-overlay';
  modalOverlay.id = 'purchaseModal';

  // Create modal box
  const modalBox = document.createElement('div');
  modalBox.className = 'modal-box';

  // Modal content
  modalBox.innerHTML = `
    <h3>Confirm Purchase</h3>
    <p>Are you sure you want to buy:</p>
    <p><strong>${item.name}</strong> for <strong>⚡${item.price}</strong>?</p>
    <div class="modal-buttons">
      <button class="confirm-button" id="confirmPurchase">Confirm</button>
      <button class="cancel-button" id="cancelPurchase">Cancel</button>
    </div>
  `;

  // Append modal to overlay
  modalOverlay.appendChild(modalBox);
  document.body.appendChild(modalOverlay);

  // Add event listeners for buttons
  document.getElementById('confirmPurchase').addEventListener('click', () => {
    buyItem(item.name);
    closeModal();
  });

  document.getElementById('cancelPurchase').addEventListener('click', closeModal);
}

/**
 * Closes the purchase modal.
 */
function closeModal() {
  const modal = document.getElementById('purchaseModal');
  if (modal) modal.remove();
}

/**
 * Send buy request to the server.
 * @param {string} itemName - Name of the item to purchase.
 */
async function buyItem(itemName) {
  const token = localStorage.getItem('token');
  if (!token) {
    alert('You must be logged in to buy items.');
    return;
  }

  try {
    const response = await fetch('/api/buy', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ itemName }),
    });

    const result = await response.json();
    if (response.ok) {
      showConfirmationPopup(`✅ Purchase successful! You bought "${itemName}".`);
      // Re-fetch the Volt balance here:
      fetchVoltBalance();
    } else {
      showConfirmationPopup(`❌ Purchase failed: ${result.error}`);
    }
  } catch (error) {
    console.error('Error processing purchase:', error);
    showConfirmationPopup('❌ An error occurred while processing your purchase.');
  }
}


/**
 * Show a simple confirmation message popup.
 * @param {string} message - The message to display.
 */
function showConfirmationPopup(message) {
  const modalOverlay = document.createElement('div');
  modalOverlay.className = 'modal-overlay';
  
  const modalBox = document.createElement('div');
  modalBox.className = 'modal-box';
  modalBox.innerHTML = `
    <p>${message}</p>
    <button class="confirm-button" id="closeModal">OK</button>
  `;

  modalOverlay.appendChild(modalBox);
  document.body.appendChild(modalOverlay);

  document.getElementById('closeModal').addEventListener('click', () => {
    modalOverlay.remove();
  });
}



// ================================================
// INVENTORY SECTION
// ================================================
const showInventoryButton = document.getElementById('showInventoryButton');
const inventorySection = document.getElementById('inventorySection');
const inventoryItems = document.getElementById('inventoryItems');

// This function fetches the user’s inventory from /api/inventory
async function fetchInventory() {
  const token = localStorage.getItem('token');
  if (!token) {
    alert('Please log in first!');
    return;
  }

  try {
    currentInventoryRoutePath = '';
    const selfName = localStorage.getItem('username');
    currentProfileUserId = localStorage.getItem('discordUserID') || null;
    currentProfileUsername = selfName || currentProfileUserId;
    currentProfileRoutePath = selfName
      ? `username/${encodeURIComponent(selfName)}`
      : (currentProfileUserId ? encodeURIComponent(currentProfileUserId) : null);
    setInventoryHeader(selfName, true, currentProfileUserId);
    const response = await fetch('/api/inventory', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error('Failed to fetch inventory');
    }

    const data = await response.json();
    const inventoryItems = document.getElementById('inventoryItems');
    inventoryItems.innerHTML = ''; // Clear existing content

    if (!data.length) {
      inventoryItems.innerHTML = '<p class="no-items">There are no items in this inventory.</p>';
      return;
    }

    data.forEach((item) => {
      const itemContainer = document.createElement('div');
      itemContainer.className = 'inventory-item raffle-item bg-content border border-accent rounded-lg p-3 my-2 shadow-md text-primary';

      // Item title
      const itemTitle = document.createElement('h3');
      itemTitle.className = 'font-bold text-highlight uppercase tracking-wide text-center';
      itemTitle.textContent = `${item.name} (Qty: ${item.quantity})`;
      itemContainer.appendChild(itemTitle);

      // Item description
      const descriptionSpan = document.createElement('p');
      descriptionSpan.className = 'text-body text-primary';
      descriptionSpan.innerHTML = item.description.replace(
        /\[([^\]]+)\]\(([^)]+)\)/g,
        '<a href="$2" target="_blank" class="link">$1</a>'
      );
      itemContainer.appendChild(descriptionSpan);

      // Click event for using the item
      itemContainer.addEventListener('click', async () => {
        const command = `%use "${item.name}"`;
        try {
          await navigator.clipboard.writeText(command);
          alert(`Copied to clipboard: ${command}\n\nClick OK to go to Discord and use your item!`);
        } catch (err) {
          console.error('Clipboard copy failed:', err);
          alert('Failed to copy. Please copy manually.');
        }
        window.open('https://discord.com/channels/1014872741846974514/1336779333641179146', '_blank');
      });

      inventoryItems.appendChild(itemContainer);
    });
  } catch (error) {
    console.error('Error fetching inventory:', error);
    inventoryItems.innerHTML = '<p class="error-text text-red-500">Error loading inventory.</p>';
  }
}


if (showInventoryButton) {
  showInventoryButton.addEventListener('click', () => {
    fetchInventory();
    // showSection('inventorySection') is your existing utility to display sections
    showSection('inventorySection');
  });
}


  // ------------------------------
// Jobs Section (with Clickable Assignment)
// ------------------------------
const showJobListButton = document.getElementById('showJobListButton');
const jobListContent = document.getElementById('jobListContent');

async function resolveUsername(userId) {
  try {
    const res = await fetch(`/api/resolveUser/${userId}`, {
      headers: getAuthHeaders(),
    });
    if (!res.ok) throw new Error(`Failed to fetch username for ${userId}`);
    const data = await res.json();
    return data.username || `UnknownUser (${userId})`;
  } catch (error) {
    console.error('Error resolving username:', error);
    return `UnknownUser (${userId})`;
  }
}

async function resolveChannelName(channelId) {
  try {
    const res = await fetch(`/api/resolveChannel/${channelId}`);
    if (!res.ok) throw new Error(`Failed to fetch channel name for ${channelId}`);
    const data = await res.json();
    return data.channelName || `UnknownChannel (${channelId})`;
  } catch (error) {
    console.error('Error resolving channel name:', error);
    return `UnknownChannel (${channelId})`;
  }
}

async function fetchJobs() {
  try {
    jobListContent.innerHTML = '<p>Loading Quests...</p>';
    const res = await fetch('/api/jobs');
    const jobs = await res.json();

    if (!jobs.length) {
      jobListContent.innerHTML = '<p class="no-jobs-message">No quests available at the moment. Please check back later.</p>';
      return;
    }

    jobListContent.innerHTML = '';
    const jobList = document.createElement('div');
    jobList.className = 'job-list';

    for (const job of jobs) {
      let description = job.description;
      const userIdMatches = description.match(/<@(\d+)>/g) || [];
      const uniqueUserIds = [...new Set(userIdMatches.map(match => match.slice(2, -1)))];
      const userMappings = {};

      await Promise.all(uniqueUserIds.map(async (userId) => {
        userMappings[userId] = await resolveUsername(userId);
      }));

      for (const userId in userMappings) {
        description = description.replace(
          new RegExp(`<@${userId}>`, 'g'),
          `<a href="https://discord.com/users/${userId}" target="_blank" class="link">@${userMappings[userId]}</a>`
        );
      }

      const channelIdMatches = description.match(/<#(\d+)>/g) || [];
      const GUILD_ID = "1014872741846974514"; // your server ID

      await Promise.all(channelIdMatches.map(async (match) => {
        const channelId = match.slice(2, -1);
        const channelName = await resolveChannelName(channelId);
        description = description.replace(
          new RegExp(`<#${channelId}>`, 'g'),
          `<a href="https://discord.com/channels/${GUILD_ID}/${channelId}" target="_blank" class="link">#${channelName}</a>`
        );
      }));
      

      description = description.replace(
        /\[([^\]]+)\]\(([^)]+)\)/g,
        '<a href="$2" target="_blank" class="link">$1</a>'
      );

      const jobItem = document.createElement('div');
      jobItem.className = 'job-item clickable-job';
      jobItem.dataset.jobId = job.jobID;
      jobItem.innerHTML = `<p><strong>Quest:</strong> ${description}</p>`;

      if (job.assignees && Array.isArray(job.assignees) && job.assignees.length > 0) {
        const assigneeLinks = await Promise.all(job.assignees.map(async (userId) => {
          const username = await resolveUsername(userId);
          return `<a href="https://discord.com/users/${userId}" target="_blank" class="link">@${username}</a>`;
        }));
        jobItem.innerHTML += `<p>Assigned to: ${assigneeLinks.join(', ')}</p>`;
      } else {
        jobItem.innerHTML += `<p>Not assigned</p>`;
      }

      // Click event to assign the user to this job
      jobItem.addEventListener('click', () => {
        assignUserToJob(job.jobID);
      });

      jobList.appendChild(jobItem);
    }

    jobListContent.appendChild(jobList);
  } catch (error) {
    console.error('Error fetching jobs:', error.message, error.stack);
    jobListContent.innerHTML = '<p>Error loading jobs. Please try again later.</p>';
  }
}

// Assigns user to a job when clicked
async function assignUserToJob(jobID) {
  const token = localStorage.getItem('token');
  if (!token) {
    alert('Please log in first!');
    return;
  }

  try {
    console.log(`[DEBUG] Sending request to assign job:`, { jobID });

    const response = await fetch('/api/assign-job', { // ✅ Ensure correct endpoint
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ jobID }),
    });

    const result = await response.json();
    console.log(`[DEBUG] Quest assignment response:`, result);

    if (response.ok) {
      showConfirmationPopup(`✅ Successfully assigned to quest: "${result.job.description}"`);
      fetchJobs(); // Refresh the job list
      fetchQuestStatus();
    } else {
      showConfirmationPopup(`❌ Quest assignment failed: ${result.error}`);
    }
  } catch (error) {
    console.error(`[ERROR] Error assigning quest:`, error);
    showConfirmationPopup('❌ Error assigning quest.');
  }
}



// Show the job list when the button is clicked
if (showJobListButton) {
  showJobListButton.addEventListener('click', () => {
    fetchJobs();
    showSection('jobList');
  });
}

document.addEventListener('click', (event) => {
  if (event.target && event.target.id === 'quitJobButton') {
    console.log("🛑 Quit Job button clicked!");
    quitJob();
  }
});

async function quitJob() {
  console.log("🚀 Sending request to quit job...");

  const token = localStorage.getItem('token');
  if (!token) {
    showConfirmationPopup('❌ You must be logged in to quit your quest.');
    return;
  }

  try {
    const response = await fetch('/api/quit-job', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    console.log("🔄 API Response:", response);

    const result = await response.json();
    console.log("📢 Server Response:", result);

    if (response.ok) {
      showConfirmationPopup(`✅ ${result.message}`);
      fetchJobs(); // Refresh job list after quitting
      fetchQuestStatus();
    } else {
      showConfirmationPopup(`❌ ${result.error}`);
    }
  } catch (error) {
    console.error('❌ Error quitting job:', error);
    showConfirmationPopup('❌ Failed to quit quest. Please try again later.');
  }
}

// ✅ Keep the original modal open/close functionality
document.addEventListener("click", (event) => {
  const modal = document.getElementById("jobSubmissionModal");

  if (event.target && event.target.id === "submitJobButton") {
    console.log("✅ Submit Quest button clicked!");
    
    if (modal) {
      modal.style.display = "flex"; // Show the modal
      console.log("📌 Submission modal is now visible.");
    } else {
      console.error("❌ Submission modal not found!");
    }
  }

  // Handle closing the modal
  if (event.target && event.target.id === "cancelSubmissionButton") {
    if (modal) {
      modal.style.display = "none"; // Hide the modal
      console.log("❌ Submission modal closed.");
    }
  }
});

// ✅ Ensure the event listener for submission is correctly attached
document.addEventListener("click", async (event) => {
  console.log(`🖱️ Click detected on element:`, event.target);

  const modal = document.getElementById("jobSubmissionModal");
  const jobDescriptionElement = document.getElementById("jobSubmissionText");

  // ✅ Capture job selection when clicking a job from the list
  if (event.target.closest(".clickable-job")) {
    const jobItem = event.target.closest(".clickable-job");
    localStorage.setItem("selectedJobID", jobItem.dataset.jobId);
    console.log(`📌 Job selected, ID: ${jobItem.dataset.jobId}`);
  }

  // ✅ Open modal when clicking "Submit Task" button
  if (event.target.id === "submitJobButton") {
    console.log("✅ Submit Quest button clicked!");
    if (modal) {
      modal.style.display = "flex";
      console.log("📌 Submission modal is now visible.");

      setTimeout(() => {
        jobDescriptionElement.focus();
      }, 100);
    } else {
      console.error("❌ Submission modal not found!");
    }
  }

  // ✅ Close modal when clicking "Cancel"
  if (event.target.id === "cancelSubmissionButton") {
    if (modal) {
      modal.style.display = "none";
      console.log("❌ Submission modal closed.");
    }
  }

  // ✅ Handle job submission
  if (event.target.id === "sendSubmissionButton") {
    console.log("🚀 Confirm job submission button clicked!");

    const selectedJobID = localStorage.getItem("selectedJobID");
    if (!selectedJobID) {
      showStyledAlert("⚠️ Please select a quest first.", 3000);
      return;
    }

    const job = await getJobById(selectedJobID);
    if (!job) {
      showStyledAlert("❌ Quest not found! Please select a valid quest.", 3000);
      return;
    }

    console.log(`📌 Using job title from database: ${job.description}`);

    if (!jobDescriptionElement) {
      console.error("❌ Job description field not found!");
      return;
    }

    const jobDescription = jobDescriptionElement.value.trim();
    const jobImageElement = document.getElementById("jobSubmissionImage");
    const jobImage = jobImageElement.files[0];

    if (!jobDescription) {
      showStyledAlert("⚠️ Please provide a task description.", 3000);
      return;
    }

    const userId = localStorage.getItem("discordUserID");
    if (!userId) {
      showStyledAlert("⚠️ User ID is missing. Please log in again.", 3000);
      return;
    }

    console.log(`📤 Preparing job submission:`, {
      userID: userId,
      title: job.description,
      description: jobDescription,
      image: jobImage ? jobImage.name : "No image uploaded"
    });

    const formData = new FormData();
    formData.append("title", job.description);
    formData.append("description", jobDescription);
    formData.append("jobID", selectedJobID);
    if (jobImage) {
      formData.append("image", jobImage);
    }

    for (let [key, value] of formData.entries()) {
      console.log(`📤 FormData -> ${key}:`, value);
    }

    try {
      const response = await fetch("/api/submit-job", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${localStorage.getItem("token")}`,
          "x-user-id": userId,
        },
        body: formData,
      });

      const result = await response.json();
      console.log("📥 Server response:", result);

      if (response.ok) {
        showStyledAlert("✅ Quest submitted successfully!", 3000);
        modal.style.display = "none";
        fetchQuestStatus();
      } else {
        showStyledAlert(`❌ Submission failed: ${result.error}`, 3000);
      }
    } catch (error) {
      console.error("❌ Error submitting job:", error);
      showStyledAlert("❌ Failed to submit quest.", 3000);
    }
  }
});

/* 🔥 Improved Image Upload UX */
const jobImageElement = document.getElementById("jobSubmissionImage");
const previewContainer = document.getElementById("imagePreviewContainer");
const previewImage = document.getElementById("imagePreview");
const removeImageButton = document.getElementById("removeImage");
const dropArea = document.getElementById("dropArea");
const maxFileSize = 5 * 1024 * 1024; // 5MB Limit

jobImageElement.addEventListener("change", () => handleFileUpload(jobImageElement.files[0]));

dropArea.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropArea.style.borderColor = "blue";
});

dropArea.addEventListener("dragleave", () => {
  dropArea.style.borderColor = "#ccc";
});

dropArea.addEventListener("drop", (e) => {
  e.preventDefault();
  dropArea.style.borderColor = "#ccc";

  const file = e.dataTransfer.files[0];
  if (file) {
    jobImageElement.files = e.dataTransfer.files;
    handleFileUpload(file);
  }
});

function handleFileUpload(file) {
  if (!file) return;

  if (!file.type.startsWith("image/")) {
    showStyledAlert("⚠️ Please upload a valid image file.", 3000);
    return;
  }

  if (file.size > maxFileSize) {
    showStyledAlert("⚠️ File is too large. Please upload an image smaller than 5MB.", 3000);
    return;
  }

  const reader = new FileReader();
  reader.onload = function (e) {
    previewImage.src = e.target.result;
    previewContainer.style.display = "block";
  };
  reader.readAsDataURL(file);
}

removeImageButton.addEventListener("click", () => {
  jobImageElement.value = "";
  previewContainer.style.display = "none";
});

/* 🔥 Styled Alert Function */
function showStyledAlert(message, duration = 3000) {
  let alertBox = document.getElementById("customAlert");

  if (!alertBox) {
    alertBox = document.createElement("div");
    alertBox.id = "customAlert";
    alertBox.classList.add("custom-alert");
    document.body.appendChild(alertBox);
  }

  alertBox.textContent = message;
  alertBox.style.opacity = "1";
  alertBox.style.animation = "slideIn 0.5s forwards";

  setTimeout(() => {
    alertBox.style.animation = "slideOut 0.5s forwards";
  }, duration);
}

/* 🔥 Fetch Job by ID */
async function getJobById(jobID) {
  try {
    const res = await fetch('/api/jobs');
    if (!res.ok) throw new Error(`Failed to fetch jobs: ${res.status} ${res.statusText}`);

    const jobs = await res.json();
    return jobs.find(j => j.jobID == jobID) || null;
  } catch (error) {
    console.error('Error fetching /api/jobs:', error);
    return null;
  }
}








// ------------------------------
// Giveaways Section (Clickable Entry)
// ------------------------------
const showGiveawayListButton = document.getElementById('showGiveawayListButton');
const giveawayItems = document.getElementById('giveawayItems');

/**
 * Fetches active giveaways from the API and renders them.
 * Users can click on a giveaway to enter.
 */
async function fetchGiveaways() {
  try {
    const res = await fetch('/api/giveaways/active');
    const giveaways = await res.json();

    if (!giveaways.length) {
      giveawayItems.innerHTML = '<p>No active giveaways at the moment.</p>';
      return;
    }

    giveawayItems.innerHTML = ''; // Clear previous content

    const options = { month: 'long', day: 'numeric', hour: 'numeric', minute: 'numeric', hour12: true };

    // Fetch entry counts for all giveaways
    for (const g of giveaways.reverse()) {
      const timestamp = g.end_time.toString().length === 10 ? g.end_time * 1000 : g.end_time;
      const endTime = new Date(timestamp).toLocaleString(undefined, options);

      // Fetch the entry count for this giveaway
      let entryCount = 0;
      try {
        const entryRes = await fetch(`/api/giveaways/${g.id}/entries`);
        const entryData = await entryRes.json();
        entryCount = entryData.entryCount || 0;
      } catch (error) {
        console.error(`Error fetching entry count for giveaway ${g.id}:`, error);
      }

      // Giveaway container
      const giveawayDiv = document.createElement('div');
      giveawayDiv.className = 'giveaway-item';
      giveawayDiv.setAttribute('data-giveaway-id', g.id);

      // Giveaway name
      const namePara = document.createElement('p');
      namePara.className = 'giveaway-name';
      namePara.textContent = g.giveaway_name;
      giveawayDiv.appendChild(namePara);

      // Giveaway details
      const detailsDiv = document.createElement('div');
      detailsDiv.className = 'giveaway-content';
      detailsDiv.innerHTML = `
        <p><strong>Prize:</strong> ${g.prize}</p>
        <p><strong>Winners:</strong> ${g.winners}</p>
        <p><strong>Entries:</strong> ${entryCount}</p>
        <p><strong>End Time:</strong> ${endTime}</p>
      `;
      giveawayDiv.appendChild(detailsDiv);

      // Click event: Enter the giveaway
      giveawayDiv.addEventListener('click', async () => {
        await enterGiveaway(g.id);
      });

      giveawayItems.appendChild(giveawayDiv);
    }
  } catch (error) {
    console.error('Error fetching giveaways:', error);
    giveawayItems.innerHTML = '<p>Error loading giveaways.</p>';
  }
}


/**
 * Sends a request to enter the giveaway.
 * @param {number} giveawayId - The ID of the giveaway.
 */
async function enterGiveaway(giveawayId) {
  const token = localStorage.getItem('token');
  if (!token) {
    alert('You must be logged in to enter giveaways.');
    return;
  }

  try {
    const res = await fetch('/api/giveaways/enter', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ giveawayId }),
    });

    const result = await res.json();

    if (res.ok) {
      if (result.joined) {
        showConfirmationPopup(`🎉 Successfully entered the giveaway!`);
      } else if (result.alreadyEntered) {
        showConfirmationPopup(`✅ You have already entered this giveaway.`);
      } else {
        showConfirmationPopup(`❌ Unable to enter the giveaway.`);
      }

      fetchGiveaways(); // Refresh list after status change
    } else {
      showConfirmationPopup(`❌ Failed to enter giveaway: ${result.error}`);
    }

  } catch (error) {
    console.error('Error entering giveaway:', error);
    showConfirmationPopup('❌ An error occurred while entering.');
  }
}


/**
 * Displays a confirmation popup.
 * @param {string} message - Message to show in the popup.
 */
function showConfirmationPopup(message) {
  const modalOverlay = document.createElement('div');
  modalOverlay.className = 'modal-overlay';

  const modalBox = document.createElement('div');
  modalBox.className = 'modal-box';
  modalBox.innerHTML = `
    <p>${message}</p>
    <button class="confirm-button" id="closeModal">OK</button>
  `;

  modalOverlay.appendChild(modalBox);
  document.body.appendChild(modalOverlay);

  document.getElementById('closeModal').addEventListener('click', () => {
    modalOverlay.remove();
  });
}

// Button event listener to show giveaways
if (showGiveawayListButton) {
  showGiveawayListButton.addEventListener('click', () => {
    fetchGiveaways();
    showSection('giveawayList');
  });
}


// ------------------------------
// Login Section & Authentication
// ------------------------------
console.log('⚡ script.js is being executed!');

const loginButton = document.getElementById('submitLogin');
const loginForm = document.getElementById('loginForm');
const usernameInput = document.getElementById('loginUsername');
const passwordInput = document.getElementById('loginPassword');
const usernameLabel = document.querySelector("label[for='loginUsername']");
const passwordLabel = document.querySelector("label[for='loginPassword']");
const discordLoginButton = document.getElementById('discordLoginButton');
const voltMenuContainer = document.getElementById('voltMenuContainer');
const sendChatButton = document.getElementById('sendChatButton');
const chatInput = document.getElementById('chatInput');
const adminAddJobButton = document.getElementById('adminAddJob');

// Ensure Volt elements are hidden initially
if (voltMenuContainer) voltMenuContainer.style.display = 'none';

// Check if user is already logged in
const token = localStorage.getItem("token");

if (token) {
  console.log("✅ User is already logged in");
  showPostLoginButtons(); // Show inventory & logout buttons immediately
}

if (loginButton) {
  console.log("✅ Login button found:", loginButton);

  loginButton.addEventListener("click", async (event) => {
    console.log("🚀 Login button clicked!");

    let username = usernameInput.value.trim().toLowerCase(); // Convert to lowercase
    const password = passwordInput.value;

    if (!username || !password) {
      console.error("❌ Please enter both username and password.");
      alert("Please enter both username and password.");
      return;
    }

    try {
      console.log("🔄 Sending login request...");

      const response = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      const data = await response.json();

      if (response.ok) {
        console.log("✅ Login successful:", data);

        // ✅ Store JWT token & user ID in localStorage
        localStorage.setItem("token", data.token);
        localStorage.setItem("discordUserID", data.userId); // Store user ID
        if (data.username) {
          localStorage.setItem('username', data.username);
        }
        cachedAdminStatus = null;

        console.log(`✅ Stored Discord User ID: ${data.userId}`);

        // Show the post-login buttons (Inventory & Logout)
        showPostLoginButtons();
      } else {
        console.error("❌ Login failed:", data.message);
        alert(`Login failed: ${data.message}`);
      }
    } catch (error) {
      console.error("❌ Error during login:", error);
      alert("An error occurred. Please try again.");
    }
  });
} else {
  console.error("❌ Login button NOT found!");
}

if (discordLoginButton) {
  discordLoginButton.addEventListener('click', () => {
    window.location.href = '/auth/discord';
  });
}

if (sendChatButton) {
  sendChatButton.addEventListener('click', sendChatMessage);
}
if (chatInput) {
  chatInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      sendChatMessage();
    }
  });
}

if (adminAddJobButton) {
  adminAddJobButton.addEventListener('click', async () => {
    const token = localStorage.getItem('token');
    if (!token) return;
    buildEditModal('Add Quest', [
      { key: 'description', label: 'Description', value: '' },
      { key: 'cooldown_value', label: 'Cooldown Amount', value: '', type: 'number' },
      {
        key: 'cooldown_unit',
        label: 'Cooldown Unit',
        value: '',
        type: 'select',
        options: [
          { label: 'None', value: '' },
          { label: 'Minute', value: 'minute' },
          { label: 'Hour', value: 'hour' },
          { label: 'Day', value: 'day' },
          { label: 'Month', value: 'month' },
        ],
      },
    ], async (data) => {
      const description = String(data.description || '').trim();
      if (!description) {
        showStyledAlert('⚠️ Please enter a description.', 3000);
        return;
      }
      if (data.cooldown_value && !data.cooldown_unit) {
        showStyledAlert('⚠️ Please choose a cooldown unit.', 3000);
        return;
      }
      if (data.cooldown_unit && !data.cooldown_value) {
        showStyledAlert('⚠️ Please enter a cooldown amount.', 3000);
        return;
      }
      if (data.cooldown_value) {
        const parsed = Number(data.cooldown_value);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          showStyledAlert('⚠️ Cooldown must be a positive number.', 3000);
          return;
        }
      }
      const result = await adminActionRequest('/api/admin/joblist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          description,
          cooldown_value: data.cooldown_value ? Math.floor(Number(data.cooldown_value)) : null,
          cooldown_unit: data.cooldown_unit || null,
        }),
      });
      if (result.ok) loadAdminJoblist();
    });
  });
}

async function loadAdminPage() {
  const token = localStorage.getItem('token');
  const submissionsList = document.getElementById('adminSubmissionsList');
  const usersList = document.getElementById('adminUserList');
  const emptyState = document.getElementById('adminSubmissionsEmpty');

  if (!token || !submissionsList || !usersList) return;

  submissionsList.innerHTML = '';
  usersList.innerHTML = '';
  if (emptyState) emptyState.style.display = 'none';

  try {
    const [subRes, userRes] = await Promise.all([
      fetch('/api/admin/submissions', {
        headers: { Authorization: `Bearer ${token}` },
      }),
      fetch('/api/admin/users', {
        headers: { Authorization: `Bearer ${token}` },
      }),
    ]);

    if (!subRes.ok || !userRes.ok) {
      throw new Error('Failed to load admin data.');
    }

    const submissions = await subRes.json();
    const users = await userRes.json();

    if (!Array.isArray(submissions) || submissions.length === 0) {
      if (emptyState) emptyState.style.display = 'block';
    } else {
      const grouped = submissions.reduce((acc, submission) => {
        const key = submission.userID;
        if (!acc[key]) {
          acc[key] = {
            userID: submission.userID,
            username: submission.username,
            items: [],
          };
        }
        acc[key].items.push(submission);
        return acc;
      }, {});

      Object.values(grouped).forEach((group) => {
        const groupContainer = document.createElement('div');
        groupContainer.className = 'admin-item';

        const header = document.createElement('div');
        header.style.display = 'flex';
        header.style.alignItems = 'center';
        header.style.justifyContent = 'space-between';
        header.style.width = '100%';

        const userLabel = group.username ? group.username : group.userID;
        const title = document.createElement('p');
        title.textContent = `${userLabel} (${group.items.length})`;
        title.style.margin = '0';

        const toggle = document.createElement('button');
        toggle.className = 'btn text-sm font-bold';
        toggle.textContent = 'VIEW QUESTS';
        toggle.style.height = '20px';
        toggle.style.width = '120px';
        toggle.style.lineHeight = '20px';
        toggle.style.padding = '0 6px';

        header.appendChild(title);
        header.appendChild(toggle);

        const list = document.createElement('div');
        list.style.display = 'none';
        list.style.marginTop = '6px';

        group.items.forEach((submission) => {
          const item = document.createElement('div');
          item.className = 'admin-item';

          const questTitle = document.createElement('p');
          questTitle.textContent = `Quest: ${submission.title}`;

          const desc = document.createElement('p');
          desc.textContent = `Desc: ${submission.description}`;

          const when = document.createElement('p');
          const time = submission.created_at
            ? new Date(submission.created_at * 1000).toLocaleString()
            : 'Unknown time';
          when.textContent = `Submitted: ${time}`;

          item.appendChild(questTitle);
          item.appendChild(desc);
          item.appendChild(when);

          if (submission.image_url) {
            const link = document.createElement('a');
            link.href = submission.image_url;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.textContent = 'View Image';
            item.appendChild(link);
          }

          item.addEventListener('click', (event) => {
            if (event.target && event.target.tagName === 'A') return;
            showSubmissionRewardModal(submission);
          });

          list.appendChild(item);
        });

        toggle.addEventListener('click', (event) => {
          event.stopPropagation();
          const isOpen = list.style.display === 'block';
          list.style.display = isOpen ? 'none' : 'block';
          toggle.textContent = isOpen ? 'VIEW QUESTS' : 'HIDE QUESTS';
        });

        groupContainer.appendChild(header);
        groupContainer.appendChild(list);
        submissionsList.appendChild(groupContainer);
      });
    }

    if (!Array.isArray(users) || users.length === 0) {
      const emptyUsers = document.createElement('div');
      emptyUsers.className = 'admin-item';
      emptyUsers.textContent = 'No users found.';
      usersList.appendChild(emptyUsers);
    } else {
      users.forEach((user) => {
        const item = document.createElement('div');
        item.className = 'admin-item';
        item.style.cursor = 'pointer';
        item.textContent = user.username || user.userID;
        item.addEventListener('click', () => {
          fetchUserInventory(user.userID);
        });
        usersList.appendChild(item);
      });
    }
  } catch (error) {
    console.error('❌ Failed to load admin dashboard:', error);
    submissionsList.innerHTML = '<div class="admin-item">Failed to load submissions.</div>';
    usersList.innerHTML = '<div class="admin-item">Failed to load users.</div>';
  }
}

function confirmTwice(message, onConfirm) {
  customConfirm(message, () => {
    customConfirm('Are you REALLY sure?', onConfirm);
  });
}

async function adminActionRequest(url, options) {
  try {
    const response = await fetch(url, options);
    let payload = {};
    try { payload = await response.json(); } catch (e) {}
    if (!response.ok) {
      showConfirmationPopup(`❌ ${payload.message || 'Request failed.'}`);
      return { ok: false, payload };
    }
    showConfirmationPopup(`✅ ${payload.message || 'Updated.'}`);
    return { ok: true, payload };
  } catch (error) {
    console.error('❌ Admin action failed:', error);
    showConfirmationPopup('❌ Request failed.');
    return { ok: false, payload: {} };
  }
}

function initAdminToggles() {
  document.querySelectorAll('.admin-toggle').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const targetId = btn.getAttribute('data-target');
      if (!targetId) return;
      const activePanel = getActiveAdminPanelId();
      if (activePanel === targetId && document.getElementById(targetId)?.style.display === 'block') {
        await openAdminSection(DEFAULT_ADMIN_PANEL);
        return;
      }
      await openAdminSection(targetId);
    });
  });
}

async function loadAdminUsers() {
  const token = localStorage.getItem('token');
  const usersList = document.getElementById('adminUserList');
  const searchInput = document.getElementById('adminUserSearch');
  if (!token || !usersList) return;
  usersList.innerHTML = '';
  try {
    const res = await fetch('/api/admin/users', { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error('Failed to load users.');
    const users = await res.json();
    if (!users.length) {
      usersList.innerHTML = '<div class="admin-item">No users found.</div>';
      return;
    }

    usersList.dataset.rawHolderList = buildAdminHolderRawList(users);

    users.forEach((user) => {
      const item = document.createElement('div');
      item.className = 'admin-item admin-user-item';
      item.style.cursor = 'pointer';

      const profileName = user.userTag || user.username || user.userID;
      const profileRoutePath = buildUsernameRoutePath(user.username, user.userID);
      const profileHref = routeToPathname('userProfileSection', profileRoutePath);
      const xHandle = String(user.twitterHandle || '').trim().replace(/^@+/, '');
      const xProfileUrl = xHandle ? `https://x.com/${encodeURIComponent(xHandle)}` : '';
      const xMetaHtml = xHandle
        ? `<a href="${xProfileUrl}" target="_blank" rel="noopener noreferrer" class="admin-user-x-link">@${escapeHtml(xHandle)}</a>`
        : escapeHtml('No linked X');
      const walletText = user.walletAddress || 'No linked wallet';
      item.dataset.searchIndex = [
        profileName,
        user.username,
        user.userID,
        xHandle,
        user.walletAddress,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      item.innerHTML = `
        <div class="admin-user-row">
          <div class="admin-user-details">
            <div class="admin-user-name">${escapeHtml(profileName)}</div>
            <div class="admin-user-meta"><strong>Volt:</strong> <a href="${escapeHtml(profileHref)}" class="admin-user-profile-link">${escapeHtml(profileHref)}</a></div>
            <div class="admin-user-meta"><strong>X:</strong> ${xMetaHtml}</div>
            <div class="admin-user-wallet"><strong>Wallet:</strong> <span class="wallet-address-preserve-case">${escapeHtml(walletText)}</span></div>
          </div>
          <div class="admin-user-actions"></div>
        </div>
      `;

      const xLink = item.querySelector('.admin-user-x-link');
      if (xLink) {
        xLink.addEventListener('click', (event) => {
          event.stopPropagation();
        });
      }

      const profileLink = item.querySelector('.admin-user-profile-link');
      if (profileLink) {
        profileLink.addEventListener('click', async (event) => {
          event.preventDefault();
          event.stopPropagation();
          await fetchUserHoldingsByProfileRoute(profileRoutePath);
          showSection('userProfileSection', { profileRoutePath });
        });
      }

      const actions = item.querySelector('.admin-user-actions');
      if (actions && user.walletAddress) {
        const copyButton = document.createElement('button');
        copyButton.type = 'button';
        copyButton.className = 'admin-copy-wallet-button';
        copyButton.textContent = 'Copy Wallet';
        copyButton.addEventListener('click', async (event) => {
          event.stopPropagation();
          try {
            await navigator.clipboard.writeText(user.walletAddress);
            showConfirmationPopup(`✅ Copied wallet for ${profileName}`);
          } catch (error) {
            console.error('❌ Failed to copy wallet address:', error);
            showConfirmationPopup('❌ Failed to copy wallet address.');
          }
        });
        actions.appendChild(copyButton);
      }

      item.addEventListener('click', () => {
        currentProfileUserId = user.userID;
        currentProfileUsername = profileName;
        fetchUserInventory(user.userID);
        showSection('inventorySection');
      });
      usersList.appendChild(item);
    });

    applyAdminUserSearchFilter(searchInput?.value || '');
  } catch (error) {
    console.error('❌ Failed to load users:', error);
    usersList.innerHTML = '<div class="admin-item">Failed to load users.</div>';
  }
}

function applyAdminUserSearchFilter(query) {
  const usersList = document.getElementById('adminUserList');
  if (!usersList) return;

  const normalizedQuery = String(query || '').trim().toLowerCase();
  const userItems = usersList.querySelectorAll('.admin-user-item');
  let visibleCount = 0;

  userItems.forEach((item) => {
    const isMatch = !normalizedQuery || (item.dataset.searchIndex || '').includes(normalizedQuery);
    item.style.display = isMatch ? 'block' : 'none';
    if (isMatch) visibleCount += 1;
  });

  let emptyState = document.getElementById('adminUserSearchEmpty');
  if (!visibleCount && userItems.length) {
    if (!emptyState) {
      emptyState = document.createElement('div');
      emptyState.id = 'adminUserSearchEmpty';
      emptyState.className = 'admin-item';
      emptyState.textContent = 'No users match that search.';
      usersList.appendChild(emptyState);
    }
    emptyState.style.display = 'block';
  } else if (emptyState) {
    emptyState.style.display = 'none';
  }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

function buildAdminHolderRawList(users) {
  const lines = ['holder_name\twallet_address\ttwitter_account'];
  (users || [])
    .filter((user) => user?.walletAddress)
    .forEach((user) => {
      const holderName = user.userTag || user.username || user.twitterHandle || user.userID || 'Unknown';
      const twitterAccount = user.twitterHandle ? `@${user.twitterHandle}` : '';
      lines.push(`${holderName}\t${user.walletAddress}\t${twitterAccount}`);
    });
  return lines.join('\n');
}

function showAdminHolderRawModal(rawText) {
  const existing = document.getElementById('adminHolderRawModal');
  if (existing) existing.remove();

  const modalOverlay = document.createElement('div');
  modalOverlay.className = 'modal-overlay';
  modalOverlay.id = 'adminHolderRawModal';

  const modalBox = document.createElement('div');
  modalBox.className = 'modal-box admin-holder-raw-modal';
  modalBox.innerHTML = `
    <h2>Raw Holder List</h2>
    <textarea id="adminHolderRawText" class="admin-holder-raw-text" readonly></textarea>
    <div class="modal-buttons">
      <button class="confirm-button" id="adminHolderRawCopy">Copy Text</button>
      <button class="cancel-button" id="adminHolderRawClose">Close</button>
    </div>
  `;

  modalOverlay.appendChild(modalBox);
  document.body.appendChild(modalOverlay);

  const textArea = document.getElementById('adminHolderRawText');
  if (textArea) textArea.value = rawText || 'holder_name\twallet_address\ttwitter_account';

  document.getElementById('adminHolderRawClose').addEventListener('click', () => modalOverlay.remove());
  document.getElementById('adminHolderRawCopy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(textArea?.value || '');
      showConfirmationPopup('✅ Copied raw holder list.');
    } catch (error) {
      console.error('❌ Failed to copy raw holder list:', error);
      showConfirmationPopup('❌ Failed to copy raw holder list.');
    }
  });
}

const adminShowHolderRawButton = document.getElementById('adminShowHolderRaw');
if (adminShowHolderRawButton) {
  adminShowHolderRawButton.addEventListener('click', () => {
    const usersList = document.getElementById('adminUserList');
    const rawText = usersList?.dataset?.rawHolderList || 'holder_name\twallet_address\ttwitter_account';
    showAdminHolderRawModal(rawText);
  });
}

const adminUserSearchInput = document.getElementById('adminUserSearch');
if (adminUserSearchInput) {
  adminUserSearchInput.addEventListener('input', (event) => {
    applyAdminUserSearchFilter(event.target.value);
  });
}

function buildEditModal(title, fields, onSubmit) {
  const existing = document.getElementById('adminEditModal');
  if (existing) existing.remove();

  const modalOverlay = document.createElement('div');
  modalOverlay.className = 'modal-overlay';
  modalOverlay.id = 'adminEditModal';

  const modalBox = document.createElement('div');
  modalBox.className = 'modal-box';
  modalBox.innerHTML = `<h2>${title}</h2>`;

  fields.forEach((field) => {
    const label = document.createElement('label');
    label.textContent = field.label;
    label.style.display = 'block';
    label.style.marginTop = '8px';
    modalBox.appendChild(label);

    let input;
    if (field.type === 'select') {
      input = document.createElement('select');
      (field.options || []).forEach((option) => {
        const opt = document.createElement('option');
        opt.value = option.value;
        opt.textContent = option.label;
        input.appendChild(opt);
      });
      input.value = field.value ?? '';
    } else {
      input = document.createElement('input');
      input.type = field.type || 'text';
      input.value = field.value ?? '';
      input.placeholder = field.label;
    }
    input.dataset.key = field.key;
    input.style.margin = '6px 0';
    input.style.width = '100%';
    input.style.padding = '6px';
    modalBox.appendChild(input);
  });

  const buttons = document.createElement('div');
  buttons.className = 'modal-buttons';
  buttons.innerHTML = `
    <button class="confirm-button" id="adminEditConfirm">Confirm</button>
    <button class="cancel-button" id="adminEditCancel">Cancel</button>
  `;
  modalBox.appendChild(buttons);
  modalOverlay.appendChild(modalBox);
  document.body.appendChild(modalOverlay);

  document.getElementById('adminEditCancel').addEventListener('click', () => modalOverlay.remove());
  document.getElementById('adminEditConfirm').addEventListener('click', () => {
    const data = {};
    modalBox.querySelectorAll('input, select').forEach((input) => {
      data[input.dataset.key] = input.value;
    });
    confirmTwice('Are you sure you want to edit this?', async () => {
      await onSubmit(data);
      modalOverlay.remove();
    });
  });
}

function msToDays(ms) {
  return Math.max(0, Math.round((ms || 0) / (24 * 60 * 60 * 1000)));
}

function daysFromNow(days) {
  const value = Number(days);
  if (!Number.isFinite(value) || value <= 0) return Date.now() + 24 * 60 * 60 * 1000;
  return Date.now() + value * 24 * 60 * 60 * 1000;
}

function normalizeEndTime(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  // Treat small values as seconds-based timestamps.
  return num < 1e12 ? num * 1000 : num;
}

function durationFromNow(value, unit) {
  const amount = Number(value);
  const multipliers = {
    minutes: 60 * 1000,
    hours: 60 * 60 * 1000,
    days: 24 * 60 * 60 * 1000,
  };
  const multiplier = multipliers[unit] || multipliers.days;
  if (!Number.isFinite(amount) || amount <= 0) return Date.now() + multipliers.days;
  return Date.now() + amount * multiplier;
}

let adminShopItemsCache = null;
async function getAdminShopItems(token) {
  if (Array.isArray(adminShopItemsCache)) return adminShopItemsCache;
  try {
    const res = await fetch('/api/admin/shop-items', { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error('Failed to load shop items.');
    const items = await res.json();
    if (Array.isArray(items)) {
      adminShopItemsCache = items
        .map((item) => (typeof item === 'string' ? item : item?.name))
        .filter((item) => typeof item === 'string' && item.length);
    } else {
      adminShopItemsCache = [];
    }
    return adminShopItemsCache;
  } catch (error) {
    console.error('❌ Failed to load shop items:', error);
    adminShopItemsCache = [];
    return adminShopItemsCache;
  }
}

function buildPrizeDurationModal({ title, fields, durationValue, durationUnit, shopItems, onSubmit }) {
  const existing = document.getElementById('adminEditModal');
  if (existing) existing.remove();

  const modalOverlay = document.createElement('div');
  modalOverlay.className = 'modal-overlay';
  modalOverlay.id = 'adminEditModal';

  const modalBox = document.createElement('div');
  modalBox.className = 'modal-box';
  modalBox.innerHTML = `<h2>${title}</h2>`;

  fields.forEach((field) => {
    const label = document.createElement('label');
    label.textContent = field.label;
    label.style.display = 'block';
    label.style.marginTop = '8px';
    modalBox.appendChild(label);

    if (field.type === 'prize') {
      const listId = `adminShopItems-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const input = document.createElement('input');
      input.type = 'text';
      input.value = field.value ?? '';
      input.placeholder = field.placeholder || field.label;
      input.dataset.key = field.key;
      input.style.margin = '6px 0';
      input.style.width = '100%';
      input.style.padding = '6px';
      input.setAttribute('list', listId);
      modalBox.appendChild(input);

      const datalist = document.createElement('datalist');
      datalist.id = listId;
      (shopItems || []).forEach((item) => {
        const option = document.createElement('option');
        option.value = item;
        datalist.appendChild(option);
      });
      modalBox.appendChild(datalist);
      return;
    }

    const input = document.createElement('input');
    input.type = 'text';
    input.value = field.value ?? '';
    input.placeholder = field.label;
    input.dataset.key = field.key;
    input.style.margin = '6px 0';
    input.style.width = '100%';
    input.style.padding = '6px';
    modalBox.appendChild(input);
  });

  const durationLabel = document.createElement('label');
  durationLabel.textContent = 'End Time';
  durationLabel.style.display = 'block';
  durationLabel.style.marginTop = '8px';
  modalBox.appendChild(durationLabel);

  const durationRow = document.createElement('div');
  durationRow.style.display = 'flex';
  durationRow.style.gap = '8px';
  durationRow.style.alignItems = 'center';

  const durationInput = document.createElement('input');
  durationInput.type = 'text';
  durationInput.value = durationValue ?? '';
  durationInput.placeholder = 'Duration';
  durationInput.dataset.key = 'end_time';
  durationInput.style.flex = '1';
  durationInput.style.margin = '6px 0';
  durationInput.style.padding = '6px';

  const durationSelect = document.createElement('select');
  durationSelect.dataset.key = 'end_time_unit';
  durationSelect.style.margin = '6px 0';
  durationSelect.style.padding = '6px';
  ['minutes', 'hours', 'days'].forEach((unit) => {
    const option = document.createElement('option');
    option.value = unit;
    option.textContent = unit;
    if (unit === (durationUnit || 'days')) option.selected = true;
    durationSelect.appendChild(option);
  });

  durationRow.appendChild(durationInput);
  durationRow.appendChild(durationSelect);
  modalBox.appendChild(durationRow);

  const buttons = document.createElement('div');
  buttons.className = 'modal-buttons';
  buttons.innerHTML = `
    <button class="confirm-button" id="adminEditConfirm">Confirm</button>
    <button class="cancel-button" id="adminEditCancel">Cancel</button>
  `;
  modalBox.appendChild(buttons);
  modalOverlay.appendChild(modalBox);
  document.body.appendChild(modalOverlay);

  document.getElementById('adminEditCancel').addEventListener('click', () => modalOverlay.remove());
  document.getElementById('adminEditConfirm').addEventListener('click', () => {
    const data = {};
    modalBox.querySelectorAll('input').forEach((input) => {
      data[input.dataset.key] = input.value;
    });
    const unit = modalBox.querySelector('select[data-key="end_time_unit"]')?.value || 'days';
    confirmTwice('Are you sure you want to edit this?', async () => {
      await onSubmit(data, unit);
      modalOverlay.remove();
    });
  });
}

async function loadAdminGiveaways() {
  const token = localStorage.getItem('token');
  const list = document.getElementById('adminGiveawaysList');
  if (!token || !list) return;
  list.innerHTML = '';

  const createRow = document.createElement('div');
  createRow.className = 'admin-actions';
  const createBtn = document.createElement('button');
  createBtn.className = 'btn';
  createBtn.textContent = 'Create Giveaway';
  createRow.appendChild(createBtn);
  list.appendChild(createRow);
  createBtn.addEventListener('click', async () => {
    const shopItems = await getAdminShopItems(token);
    buildPrizeDurationModal({
      title: 'Create Giveaway',
      fields: [
        { key: 'giveaway_name', label: 'Name', value: '' },
        { key: 'prize', label: 'Prize (shop item or Volts)', value: '', type: 'prize', placeholder: 'Item name or Volt amount' },
        { key: 'winners', label: 'Winners', value: 1 },
        { key: 'repeat', label: 'Repeat (0/1)', value: 0 },
      ],
      durationValue: 1,
      durationUnit: 'days',
      shopItems,
      onSubmit: async (data, unit) => {
        const payload = {
          ...data,
          end_time: durationFromNow(data.end_time, unit),
        };
        const result = await adminActionRequest('/api/admin/giveaways/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(payload),
        });
        if (result.ok) loadAdminGiveaways();
      },
    });
  });

  try {
    const res = await fetch('/api/admin/giveaways', { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error('Failed to load giveaways.');
    const items = (await res.json()).filter((g) => !g.end_time || g.end_time > Date.now());
    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'admin-item';
      empty.textContent = 'No giveaways found.';
      list.appendChild(empty);
      return;
    }
    items.forEach((g) => {
      const item = document.createElement('div');
      item.className = 'admin-item';
      const end = g.end_time ? new Date(g.end_time).toLocaleString() : 'N/A';
      item.innerHTML = `<p><strong>${g.giveaway_name}</strong></p><p>Prize: ${g.prize} | Winners: ${g.winners}</p><p>Ends: ${end}</p>`;
      const actions = document.createElement('div');
      actions.className = 'modal-buttons';
      const editBtn = document.createElement('button');
      editBtn.className = 'confirm-button';
      editBtn.textContent = 'Edit';
      const startBox = document.createElement('div');
      startBox.className = 'admin-placeholder';
      startBox.textContent = 'Started';
      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'cancel-button';
      cancelBtn.textContent = 'Cancel';
      actions.appendChild(editBtn);
      actions.appendChild(startBox);
      actions.appendChild(cancelBtn);
      item.appendChild(actions);

      editBtn.addEventListener('click', async () => {
        const shopItems = await getAdminShopItems(token);
        buildPrizeDurationModal({
          title: 'Edit Giveaway',
          fields: [
            { key: 'giveaway_name', label: 'Name', value: g.giveaway_name },
            { key: 'prize', label: 'Prize (shop item or Volts)', value: g.prize, type: 'prize', placeholder: 'Item name or Volt amount' },
            { key: 'winners', label: 'Winners', value: g.winners },
            { key: 'repeat', label: 'Repeat (0/1)', value: g.repeat },
          ],
          durationValue: msToDays(g.end_time - Date.now()),
          durationUnit: 'days',
          shopItems,
          onSubmit: async (data, unit) => {
            const payload = {
              ...data,
              end_time: durationFromNow(data.end_time, unit),
            };
            const result = await adminActionRequest(`/api/admin/giveaways/${g.id}/update`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              body: JSON.stringify(payload),
            });
            if (result.ok) loadAdminGiveaways();
          },
        });
      });
      cancelBtn.addEventListener('click', () => {
        confirmTwice('Cancel this giveaway?', async () => {
          const result = await adminActionRequest(`/api/admin/giveaways/${g.id}/stop`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
          });
          if (result.ok) loadAdminGiveaways();
        });
      });

      list.appendChild(item);
    });
  } catch (error) {
    console.error('❌ Failed to load giveaways:', error);
    list.innerHTML = '<div class="admin-item">Failed to load giveaways.</div>';
  }
}

async function loadAdminTitleGiveaways() {
  const token = localStorage.getItem('token');
  const list = document.getElementById('adminTitleGiveawaysList');
  if (!token || !list) return;
  list.innerHTML = '';

  const createRow = document.createElement('div');
  createRow.className = 'admin-actions';
  const createBtn = document.createElement('button');
  createBtn.className = 'btn';
  createBtn.textContent = 'Create Title Giveaway';
  createRow.appendChild(createBtn);
  list.appendChild(createRow);
  createBtn.addEventListener('click', async () => {
    const shopItems = await getAdminShopItems(token);
    buildPrizeDurationModal({
      title: 'Create Title Giveaway',
      fields: [
        { key: 'giveaway_name', label: 'Name', value: '' },
        { key: 'prize', label: 'Prize (shop item or Volts)', value: '', type: 'prize', placeholder: 'Item name or Volt amount' },
        { key: 'winners', label: 'Winners', value: 1 },
        { key: 'repeat', label: 'Repeat (0/1)', value: 0 },
      ],
      durationValue: 1,
      durationUnit: 'days',
      shopItems,
      onSubmit: async (data, unit) => {
        const payload = {
          ...data,
          end_time: durationFromNow(data.end_time, unit),
        };
        const result = await adminActionRequest('/api/admin/title-giveaways/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(payload),
        });
        if (result.ok) loadAdminTitleGiveaways();
      },
    });
  });

  try {
    const res = await fetch('/api/admin/title-giveaways', { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error('Failed to load title giveaways.');
    const items = (await res.json()).filter((g) => g.is_completed !== 1 && (!g.end_time || g.end_time > Date.now()));
    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'admin-item';
      empty.textContent = 'No title giveaways found.';
      list.appendChild(empty);
      return;
    }
    items.forEach((g) => {
      const item = document.createElement('div');
      item.className = 'admin-item';
      const end = g.end_time ? new Date(g.end_time).toLocaleString() : 'N/A';
      item.innerHTML = `<p><strong>${g.giveaway_name}</strong></p><p>Prize: ${g.prize} | Winners: ${g.winners}</p><p>Ends: ${end}</p>`;
      const actions = document.createElement('div');
      actions.className = 'modal-buttons';
      const editBtn = document.createElement('button');
      editBtn.className = 'confirm-button';
      editBtn.textContent = 'Edit';
      const startBox = document.createElement('div');
      startBox.className = 'admin-placeholder';
      startBox.textContent = 'Started';
      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'cancel-button';
      cancelBtn.textContent = 'Cancel';
      actions.appendChild(editBtn);
      actions.appendChild(startBox);
      actions.appendChild(cancelBtn);
      item.appendChild(actions);

      editBtn.addEventListener('click', async () => {
        const shopItems = await getAdminShopItems(token);
        buildPrizeDurationModal({
          title: 'Edit Title Giveaway',
          fields: [
            { key: 'giveaway_name', label: 'Name', value: g.giveaway_name },
            { key: 'prize', label: 'Prize (shop item or Volts)', value: g.prize, type: 'prize', placeholder: 'Item name or Volt amount' },
            { key: 'winners', label: 'Winners', value: g.winners },
            { key: 'repeat', label: 'Repeat (0/1)', value: g.repeat },
          ],
          durationValue: msToDays(g.end_time - Date.now()),
          durationUnit: 'days',
          shopItems,
          onSubmit: async (data, unit) => {
            const payload = {
              ...data,
              end_time: durationFromNow(data.end_time, unit),
            };
            const result = await adminActionRequest(`/api/admin/title-giveaways/${g.id}/update`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              body: JSON.stringify(payload),
            });
            if (result.ok) loadAdminTitleGiveaways();
          },
        });
      });
      cancelBtn.addEventListener('click', () => {
        confirmTwice('Cancel this title giveaway?', async () => {
          const result = await adminActionRequest(`/api/admin/title-giveaways/${g.id}/stop`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
          });
          if (result.ok) loadAdminTitleGiveaways();
        });
      });

      list.appendChild(item);
    });

  } catch (error) {
    console.error('❌ Failed to load title giveaways:', error);
    list.innerHTML = '<div class="admin-item">Failed to load title giveaways.</div>';
  }
}

async function loadAdminRaffles() {
  const token = localStorage.getItem('token');
  const list = document.getElementById('adminRafflesList');
  if (!token || !list) return;
  list.innerHTML = '';

  const createRow = document.createElement('div');
  createRow.className = 'admin-actions';
  const createBtn = document.createElement('button');
  createBtn.className = 'btn';
  createBtn.textContent = 'Create Raffle';
  createRow.appendChild(createBtn);
  list.appendChild(createRow);
  createBtn.addEventListener('click', async () => {
    const shopItems = await getAdminShopItems(token);
    buildPrizeDurationModal({
      title: 'Create Raffle',
      fields: [
        { key: 'name', label: 'Name', value: '' },
        { key: 'prize', label: 'Prize (shop item or Volts)', value: '', type: 'prize', placeholder: 'Item name or Volt amount' },
        { key: 'cost', label: 'Cost', value: 1 },
        { key: 'quantity', label: 'Quantity', value: 1 },
        { key: 'winners', label: 'Winners', value: 1 },
      ],
      durationValue: 1,
      durationUnit: 'days',
      shopItems,
      onSubmit: async (data, unit) => {
        const payload = {
          ...data,
          end_time: durationFromNow(data.end_time, unit),
        };
        const result = await adminActionRequest('/api/admin/raffles/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(payload),
        });
        if (result.ok) loadAdminRaffles();
      },
    });
  });

  try {
    const res = await fetch('/api/admin/raffles', { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error('Failed to load raffles.');
    const items = (await res.json()).filter((r) => {
      const endTime = normalizeEndTime(r.end_time);
      return !endTime || endTime > Date.now();
    });
    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'admin-item';
      empty.textContent = 'No raffles found.';
      list.appendChild(empty);
      return;
    }
    items.forEach((r) => {
      const item = document.createElement('div');
      item.className = 'admin-item';
      const normalizedEnd = normalizeEndTime(r.end_time);
      const end = normalizedEnd ? new Date(normalizedEnd).toLocaleString() : 'N/A';
      item.innerHTML = `<p><strong>${r.name}</strong></p><p>Prize: ${r.prize} | Winners: ${r.winners}</p><p>Ends: ${end}</p>`;
      const actions = document.createElement('div');
      actions.className = 'modal-buttons';
      const editBtn = document.createElement('button');
      editBtn.className = 'confirm-button';
      editBtn.textContent = 'Edit';
      const startBox = document.createElement('div');
      startBox.className = 'admin-placeholder';
      startBox.textContent = 'Started';
      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'cancel-button';
      cancelBtn.textContent = 'Cancel';
      actions.appendChild(editBtn);
      actions.appendChild(startBox);
      actions.appendChild(cancelBtn);
      item.appendChild(actions);

      editBtn.addEventListener('click', async () => {
        const shopItems = await getAdminShopItems(token);
        buildPrizeDurationModal({
          title: 'Edit Raffle',
          fields: [
            { key: 'name', label: 'Name', value: r.name },
            { key: 'prize', label: 'Prize (shop item or Volts)', value: r.prize, type: 'prize', placeholder: 'Item name or Volt amount' },
            { key: 'cost', label: 'Cost', value: r.cost },
            { key: 'quantity', label: 'Quantity', value: r.quantity },
            { key: 'winners', label: 'Winners', value: r.winners },
          ],
          durationValue: msToDays((normalizeEndTime(r.end_time) || Date.now()) - Date.now()),
          durationUnit: 'days',
          shopItems,
          onSubmit: async (data, unit) => {
            const payload = {
              ...data,
              end_time: durationFromNow(data.end_time, unit),
            };
            const result = await adminActionRequest(`/api/admin/raffles/${r.id}/update`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              body: JSON.stringify(payload),
            });
            if (result.ok) loadAdminRaffles();
          },
        });
      });
      cancelBtn.addEventListener('click', () => {
        confirmTwice('Cancel this raffle?', async () => {
          const result = await adminActionRequest(`/api/admin/raffles/${r.id}/stop`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
          });
          if (result.ok) loadAdminRaffles();
        });
      });

      list.appendChild(item);
    });
  } catch (error) {
    console.error('❌ Failed to load raffles:', error);
    list.innerHTML = '<div class="admin-item">Failed to load raffles.</div>';
  }
}

function formatCooldownLabel(value, unit) {
  if (!value || !unit) return 'None';
  const normalizedUnit = String(unit).replace(/s$/, '');
  const plural = Number(value) === 1 ? normalizedUnit : `${normalizedUnit}s`;
  return `${value} ${plural}`;
}

async function loadAdminJoblist() {
  const token = localStorage.getItem('token');
  const list = document.getElementById('adminJobList');
  if (!token || !list) return;
  list.innerHTML = '';
  try {
    const res = await fetch('/api/admin/joblist', { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error('Failed to load job list.');
    const items = await res.json();
    if (!items.length) {
      list.innerHTML = '<div class="admin-item">No quests found.</div>';
      return;
    }
    items.forEach((job) => {
      const item = document.createElement('div');
      item.className = 'admin-item';
      const cooldownLabel = formatCooldownLabel(job.cooldown_value, job.cooldown_unit);
      item.innerHTML = `<p><strong>#${job.jobID}</strong> ${job.description}</p><p>Cooldown: ${cooldownLabel}</p>`;
      const actions = document.createElement('div');
      actions.className = 'modal-buttons';
      const editBtn = document.createElement('button');
      editBtn.className = 'confirm-button';
      editBtn.textContent = 'Edit';
      const delBtn = document.createElement('button');
      delBtn.className = 'cancel-button';
      delBtn.textContent = 'Delete';
      actions.appendChild(editBtn);
      actions.appendChild(delBtn);
      item.appendChild(actions);

      editBtn.addEventListener('click', () => {
        buildEditModal('Edit Quest', [
          { key: 'description', label: 'Description', value: job.description },
          { key: 'cooldown_value', label: 'Cooldown Amount', value: job.cooldown_value ?? '', type: 'number' },
          {
            key: 'cooldown_unit',
            label: 'Cooldown Unit',
            value: job.cooldown_unit ?? '',
            type: 'select',
            options: [
              { label: 'None', value: '' },
              { label: 'Minute', value: 'minute' },
              { label: 'Hour', value: 'hour' },
              { label: 'Day', value: 'day' },
              { label: 'Month', value: 'month' },
            ],
          },
        ], async (data) => {
          if (data.cooldown_value && !data.cooldown_unit) {
            showStyledAlert('⚠️ Please choose a cooldown unit.', 3000);
            return;
          }
          if (data.cooldown_unit && !data.cooldown_value) {
            showStyledAlert('⚠️ Please enter a cooldown amount.', 3000);
            return;
          }
          if (data.cooldown_value) {
            const parsed = Number(data.cooldown_value);
            if (!Number.isFinite(parsed) || parsed <= 0) {
              showStyledAlert('⚠️ Cooldown must be a positive number.', 3000);
              return;
            }
          }
          const result = await adminActionRequest(`/api/admin/joblist/${job.jobID}/update`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({
              description: data.description,
              cooldown_value: data.cooldown_value ? Math.floor(Number(data.cooldown_value)) : null,
              cooldown_unit: data.cooldown_unit || null,
            }),
          });
          if (result.ok) loadAdminJoblist();
        });
      });
      delBtn.addEventListener('click', () => {
        confirmTwice('Delete this quest?', async () => {
          const result = await adminActionRequest(`/api/admin/joblist/${job.jobID}/delete`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
          });
          if (result.ok) loadAdminJoblist();
        });
      });

      list.appendChild(item);
    });
  } catch (error) {
    console.error('❌ Failed to load job list:', error);
    list.innerHTML = '<div class="admin-item">Failed to load job list.</div>';
  }
}

async function loadAdminRedemptions() {
  const token = localStorage.getItem('token');
  const list = document.getElementById('adminRedemptionsList');
  if (!token || !list) return;
  list.innerHTML = '';
  try {
    const res = await fetch('/api/admin/redemptions', { headers: { Authorization: `Bearer ${token}` } });
    const rows = await res.json();
    if (!res.ok) {
      throw new Error(rows?.message || 'Failed to load redemptions.');
    }
    if (!Array.isArray(rows) || rows.length === 0) {
      list.innerHTML = '<div class="admin-item">No redemptions found.</div>';
      return;
    }

    rows.forEach((row) => {
      const item = document.createElement('div');
      item.className = 'admin-item';
      const walletAddress = row.wallet_address || '';
      if (walletAddress) {
        item.classList.add('admin-redemption-copyable');
        item.title = 'Click to copy wallet address';
      }
      const when = row.created_at ? new Date(row.created_at * 1000).toLocaleString() : 'Unknown time';
      const who = row.user_tag ? `${row.user_tag} (${row.userID})` : row.userID;
      const channelLabel = row.channel_name || 'Unknown Channel';
      const channelId = row.channel_id || 'unknown';
      const inventoryLine = (row.inventory_before !== null && row.inventory_after !== null)
        ? `${row.item_name} ${row.inventory_before} -> ${row.inventory_after}`
        : `${row.item_name} -> ${row.inventory_after ?? 'unknown'}`;
      const commandText = row.command_text ? row.command_text : 'N/A';
      const messageLink = row.message_link
        ? `<a href="${row.message_link}" target="_blank" class="link">Message Link</a>`
        : 'No message link';

      item.innerHTML = `
        <div><strong>Who:</strong> ${who}</div>
        <div><strong>What:</strong> ${row.item_name}</div>
        <div><strong>Where:</strong> ${row.source === 'discord' ? `Discord in ${channelLabel}` : 'Web UI Inventory'}</div>
        <div><strong>Channel ID:</strong> ${channelId}</div>
        <div><strong>When:</strong> ${when}</div>
        <div><strong>Solana Wallet:</strong> <span class="wallet-address-preserve-case">${walletAddress || 'N/A'}</span></div>
        <div><strong>Inventory:</strong> ${inventoryLine}</div>
        <div><strong>Command:</strong> ${commandText}</div>
        <div><strong>Message:</strong> ${messageLink}</div>
      `;
      if (walletAddress) {
        item.addEventListener('click', async (event) => {
          if (event.target.closest('a')) return;
          try {
            await navigator.clipboard.writeText(walletAddress);
            showConfirmationPopup('✅ Wallet address copied.');
          } catch (copyError) {
            console.error('Failed to copy wallet address:', copyError);
            showConfirmationPopup('❌ Failed to copy wallet address.');
          }
        });
      }
      list.appendChild(item);
    });
  } catch (error) {
    console.error('❌ Failed to load redemptions:', error);
    list.innerHTML = '<div class="admin-item">Failed to load redemptions.</div>';
  }
}

async function loadAdminCallAttendance() {
  const token = localStorage.getItem('token');
  const list = document.getElementById('adminCallAttendanceList');
  if (!token || !list) return;

  list.innerHTML = '';

  try {
    const res = await fetch('/api/admin/call-attendance', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const rows = await res.json();

    if (!res.ok) {
      throw new Error(rows?.message || 'Failed to load call attendance.');
    }

    if (!Array.isArray(rows) || rows.length === 0) {
      list.innerHTML = '<div class="admin-item">No call attendance records found.</div>';
      return;
    }

    const callsByStart = rows.reduce((acc, row) => {
      const callKey = String(row.meeting_started_at || 'unknown');
      if (!acc[callKey]) {
        acc[callKey] = {
          meeting_started_at: row.meeting_started_at,
          attendees: [],
        };
      }
      acc[callKey].attendees.push(row);
      return acc;
    }, {});

    Object.values(callsByStart)
      .sort((left, right) => Number(right.meeting_started_at || 0) - Number(left.meeting_started_at || 0))
      .forEach((callGroup) => {
        const item = document.createElement('details');
        item.className = 'admin-item';

        const meetingStarted = callGroup.meeting_started_at
          ? new Date(callGroup.meeting_started_at * 1000).toLocaleString()
          : 'Unknown call date';

        const summary = document.createElement('summary');
        summary.textContent = `${meetingStarted} | ${callGroup.attendees.length} attendee${callGroup.attendees.length === 1 ? '' : 's'}`;
        item.appendChild(summary);

        const attendeesWrap = document.createElement('div');
        attendeesWrap.style.marginTop = '10px';
        attendeesWrap.style.display = 'grid';
        attendeesWrap.style.gap = '8px';

        callGroup.attendees.forEach((row) => {
          const who = row.username
            ? `${row.username} (${row.userID})`
            : row.userID;
          const rewardedAt = row.rewarded_at
            ? new Date(row.rewarded_at * 1000).toLocaleString()
            : 'Unknown';

          const attendeeItem = document.createElement('div');
          attendeeItem.className = 'admin-item';
          attendeeItem.innerHTML = `
            <div><strong>User:</strong> ${escapeHtml(who)}</div>
            <div><strong>Rewarded At:</strong> ${escapeHtml(rewardedAt)}</div>
            <div><strong>Minutes Attended:</strong> ${escapeHtml(row.minutes_attended ?? 'N/A')}</div>
            <div><strong>Reward Amount:</strong> ${escapeHtml(row.reward_amount ?? 'N/A')}</div>
          `;
          attendeesWrap.appendChild(attendeeItem);
        });

        item.appendChild(attendeesWrap);
        list.appendChild(item);
      });
  } catch (error) {
    console.error('❌ Failed to load call attendance:', error);
    list.innerHTML = '<div class="admin-item">Failed to load call attendance.</div>';
  }
}

function buildShopItemModal({ title, item, confirmMessage, requireDoubleConfirm, onSubmit }) {
  const existing = document.getElementById('adminEditModal');
  if (existing) existing.remove();

  const modalOverlay = document.createElement('div');
  modalOverlay.className = 'modal-overlay';
  modalOverlay.id = 'adminEditModal';

  const modalBox = document.createElement('div');
  modalBox.className = 'modal-box';
  modalBox.innerHTML = `<h2>${title}</h2>`;

  const fields = [
    { key: 'name', label: 'Name', value: item?.name || '' },
    { key: 'description', label: 'Description', value: item?.description || '' },
    { key: 'price', label: 'Price', value: item?.price ?? '' },
    { key: 'quantity', label: 'Quantity', value: item?.quantity ?? 1 },
  ];

  fields.forEach((field) => {
    const label = document.createElement('label');
    label.textContent = field.label;
    label.style.display = 'block';
    label.style.marginTop = '8px';
    modalBox.appendChild(label);

    const input = document.createElement('input');
    input.type = field.key === 'price' || field.key === 'quantity' ? 'number' : 'text';
    input.value = field.value;
    input.placeholder = field.label;
    input.dataset.key = field.key;
    input.style.margin = '6px 0';
    input.style.width = '100%';
    input.style.padding = '6px';
    modalBox.appendChild(input);
  });

  const visibilityRow = document.createElement('div');
  visibilityRow.style.display = 'flex';
  visibilityRow.style.gap = '16px';
  visibilityRow.style.alignItems = 'center';
  visibilityRow.style.marginTop = '10px';

  const visibilityLabel = document.createElement('div');
  visibilityLabel.textContent = 'Visibility';
  visibilityLabel.style.fontWeight = 'bold';
  visibilityRow.appendChild(visibilityLabel);

  const availableLabel = document.createElement('label');
  availableLabel.style.display = 'flex';
  availableLabel.style.gap = '8px';
  availableLabel.style.alignItems = 'center';
  const availableInput = document.createElement('input');
  availableInput.type = 'radio';
  availableInput.name = 'shopVisibility';
  availableInput.value = 'available';
  availableInput.checked = !item?.isHidden;
  availableLabel.appendChild(availableInput);
  availableLabel.appendChild(document.createTextNode('Available'));
  visibilityRow.appendChild(availableLabel);

  const hiddenLabel = document.createElement('label');
  hiddenLabel.style.display = 'flex';
  hiddenLabel.style.gap = '8px';
  hiddenLabel.style.alignItems = 'center';
  const hiddenInput = document.createElement('input');
  hiddenInput.type = 'radio';
  hiddenInput.name = 'shopVisibility';
  hiddenInput.value = 'hidden';
  hiddenInput.checked = !!item?.isHidden;
  hiddenLabel.appendChild(hiddenInput);
  hiddenLabel.appendChild(document.createTextNode('Hidden'));
  visibilityRow.appendChild(hiddenLabel);

  modalBox.appendChild(visibilityRow);

  const redeemableRow = document.createElement('div');
  redeemableRow.style.display = 'flex';
  redeemableRow.style.gap = '8px';
  redeemableRow.style.alignItems = 'center';
  redeemableRow.style.marginTop = '10px';

  const redeemableInput = document.createElement('input');
  redeemableInput.type = 'checkbox';
  redeemableInput.dataset.key = 'isRedeemable';
  redeemableInput.checked = item?.isRedeemable !== 0;
  redeemableRow.appendChild(redeemableInput);
  redeemableRow.appendChild(document.createTextNode('Redeemable'));
  modalBox.appendChild(redeemableRow);

  const buttons = document.createElement('div');
  buttons.className = 'modal-buttons';
  buttons.innerHTML = `
    <button class="confirm-button" id="adminEditConfirm">Confirm</button>
    <button class="cancel-button" id="adminEditCancel">Cancel</button>
  `;
  modalBox.appendChild(buttons);
  modalOverlay.appendChild(modalBox);
  document.body.appendChild(modalOverlay);

  document.getElementById('adminEditCancel').addEventListener('click', () => modalOverlay.remove());
  document.getElementById('adminEditConfirm').addEventListener('click', () => {
    const data = {};
    modalBox.querySelectorAll('input').forEach((input) => {
      if (input.type === 'radio') return;
      if (input.type === 'checkbox') {
        data[input.dataset.key] = input.checked;
      } else {
        data[input.dataset.key] = input.value;
      }
    });

    const visibility = modalBox.querySelector('input[name="shopVisibility"]:checked')?.value || 'available';
    const isHidden = visibility === 'hidden';

    const name = String(data.name || '').trim();
    const description = String(data.description || '').trim();
    const price = Number(data.price);
    const quantity = Number(data.quantity);
    if (!name || !description) {
      showConfirmationPopup('❌ Name and description are required.');
      return;
    }
    if (!Number.isFinite(price) || price <= 0) {
      showConfirmationPopup('❌ Price must be a positive number.');
      return;
    }
    if (!Number.isFinite(quantity) || quantity < 0) {
      showConfirmationPopup('❌ Quantity must be 0 or more.');
      return;
    }

    const submitPayload = {
      name,
      description,
      price,
      quantity,
      isAvailable: !isHidden,
      isHidden,
      isRedeemable: !!data.isRedeemable,
    };

    const runSubmit = async () => {
      await onSubmit(submitPayload);
      modalOverlay.remove();
    };

    if (requireDoubleConfirm) {
      confirmTwice(confirmMessage || 'Are you sure you want to edit this item?', runSubmit);
    } else {
      customConfirm(confirmMessage || 'Create this item?', runSubmit);
    }
  });
}

async function loadAdminShopItems() {
  const token = localStorage.getItem('token');
  const list = document.getElementById('adminShopItemsList');
  if (!token || !list) return;
  list.innerHTML = '';

  const createRow = document.createElement('div');
  createRow.className = 'admin-actions';
  const createBtn = document.createElement('button');
  createBtn.className = 'btn';
  createBtn.textContent = 'Create Item';
  createRow.appendChild(createBtn);
  list.appendChild(createRow);

  createBtn.addEventListener('click', () => {
    buildShopItemModal({
      title: 'Create Shop Item',
      item: { name: '', description: '', price: '', quantity: 1, isAvailable: 1, isHidden: 0, isRedeemable: 1 },
      confirmMessage: 'Create this shop item?',
      requireDoubleConfirm: false,
      onSubmit: async (data) => {
        const result = await adminActionRequest('/api/admin/shop-items/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify(data),
        });
        if (result.ok) {
          adminShopItemsCache = null;
          loadAdminShopItems();
        }
      },
    });
  });

  try {
    const res = await fetch('/api/admin/shop-items', { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error('Failed to load shop items.');
    const items = await res.json();
    if (!Array.isArray(items) || items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'admin-item';
      empty.textContent = 'No shop items found.';
      list.appendChild(empty);
      return;
    }

    items.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'admin-item';

      const title = document.createElement('div');
      const statusFlags = [];
      if (item.isHidden) {
        statusFlags.push('Hidden');
      } else if (!item.isAvailable) {
        statusFlags.push('Unavailable');
      }
      const statusText = statusFlags.length ? ` (${statusFlags.join(', ')})` : '';
      title.innerHTML = `<strong>${item.name}</strong> — ⚡${item.price} | Qty: ${item.quantity}${statusText}`;
      row.appendChild(title);

      const desc = document.createElement('p');
      desc.textContent = item.description || '';
      row.appendChild(desc);

      const meta = document.createElement('div');
      meta.textContent = `Hidden: ${item.isHidden ? 'Yes' : 'No'} | Redeemable: ${item.isRedeemable ? 'Yes' : 'No'}`;
      row.appendChild(meta);

      const actions = document.createElement('div');
      actions.className = 'admin-actions';

      const editBtn = document.createElement('button');
      editBtn.className = 'btn';
      editBtn.textContent = 'Edit';
      editBtn.addEventListener('click', () => {
        buildShopItemModal({
          title: `Edit ${item.name}`,
          item,
          confirmMessage: 'Are you sure you want to edit this item?',
          requireDoubleConfirm: true,
          onSubmit: async (data) => {
            const result = await adminActionRequest(`/api/admin/shop-items/${item.itemID}/update`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
              body: JSON.stringify(data),
            });
            if (result.ok) {
              adminShopItemsCache = null;
              loadAdminShopItems();
            }
          },
        });
      });
      actions.appendChild(editBtn);

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'btn';
      deleteBtn.textContent = 'Delete';
      deleteBtn.addEventListener('click', () => {
        confirmTwice(`Delete "${item.name}"?`, async () => {
          const result = await adminActionRequest(`/api/admin/shop-items/${item.itemID}/delete`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
          });
          if (result.ok) {
            adminShopItemsCache = null;
            loadAdminShopItems();
          }
        });
      });
      actions.appendChild(deleteBtn);

      row.appendChild(actions);
      list.appendChild(row);
    });
  } catch (error) {
    console.error('❌ Failed to load shop items:', error);
    const empty = document.createElement('div');
    empty.className = 'admin-item';
    empty.textContent = 'Failed to load shop items.';
    list.appendChild(empty);
  }
}

let adminPollingIntervalId = null;
function startAdminPolling() {
  if (adminPollingIntervalId) return;
  adminPollingIntervalId = setInterval(() => {
    const adminPage = document.getElementById('adminPage');
    if (!adminPage || adminPage.style.display !== 'block') return;
    if (document.getElementById('adminSubmissionsPanel')?.style.display === 'block') loadAdminPage();
    if (document.getElementById('adminUserPanel')?.style.display === 'block') loadAdminUsers();
    if (document.getElementById('adminTitleGiveawaysPanel')?.style.display === 'block') loadAdminTitleGiveaways();
    if (document.getElementById('adminGiveawaysPanel')?.style.display === 'block') loadAdminGiveaways();
    if (document.getElementById('adminRafflesPanel')?.style.display === 'block') loadAdminRaffles();
    if (document.getElementById('adminJoblistPanel')?.style.display === 'block') loadAdminJoblist();
    if (document.getElementById('adminRedemptionsPanel')?.style.display === 'block') loadAdminRedemptions();
    if (document.getElementById('adminShopItemsPanel')?.style.display === 'block') loadAdminShopItems();
    if (document.getElementById('adminCallAttendancePanel')?.style.display === 'block') loadAdminCallAttendance();
  }, 15000);
}

let chatPollingIntervalId = null;
let chatPresenceIntervalId = null;
let chatLoading = false;
const CHAT_AUTO_SCROLL_THRESHOLD = 24;

async function loadChatMessages({ forceScrollToBottom = false } = {}) {
  const token = localStorage.getItem('token');
  const chatMessages = document.getElementById('chatMessages');
  if (!token || !chatMessages) return;

  try {
    if (chatLoading) return;
    chatLoading = true;
    const distanceFromBottom =
      chatMessages.scrollHeight - chatMessages.scrollTop - chatMessages.clientHeight;
    const shouldStickToBottom =
      forceScrollToBottom || distanceFromBottom <= CHAT_AUTO_SCROLL_THRESHOLD;

    const response = await fetch('/api/chat/messages', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error('Failed to load chat.');

    const messages = await response.json();
    chatMessages.innerHTML = '';

    messages.forEach((msg) => {
      const row = document.createElement('div');
      row.className = `chat-message ${msg.is_admin ? 'admin' : 'user'}`;

      const name = document.createElement('span');
      name.textContent = msg.username || msg.userID;
      name.style.cursor = 'pointer';
      name.style.textDecoration = 'underline';
      name.addEventListener('click', () => {
        fetchUserHoldingsFor(msg.userID);
        if (typeof showSection === 'function') {
          showSection('userProfileSection', { profileUserId: msg.userID });
        }
      });

      const text = document.createElement('span');
      text.textContent = `: ${msg.message}`;

      row.appendChild(name);
      row.appendChild(text);
      chatMessages.appendChild(row);
    });

    if (shouldStickToBottom) {
      chatMessages.scrollTop = chatMessages.scrollHeight;
    }
  } catch (error) {
    console.error('❌ Failed to load chat messages:', error);
  } finally {
    chatLoading = false;
  }
}

async function sendChatMessage() {
  const token = localStorage.getItem('token');
  const chatInput = document.getElementById('chatInput');
  if (!token || !chatInput) return;

  const message = chatInput.value.trim();
  if (!message) return;

  try {
    const response = await fetch('/api/chat/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ message }),
    });

    if (!response.ok) {
      const result = await response.json();
      showConfirmationPopup(`❌ ${result.message || 'Failed to send message.'}`);
      return;
    }

    chatInput.value = '';
    loadChatMessages({ forceScrollToBottom: true });
  } catch (error) {
    console.error('❌ Failed to send chat message:', error);
    showConfirmationPopup('❌ Failed to send message.');
  }
}

async function pingChatPresence() {
  const token = localStorage.getItem('token');
  if (!token) return;
  try {
    await fetch('/api/chat/ping', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (error) {
    console.error('❌ Failed to ping presence:', error);
  }
}

async function loadChatPresence() {
  const token = localStorage.getItem('token');
  const onlineList = document.getElementById('chatOnlineList');
  if (!token || !onlineList) return;

  try {
    const response = await fetch('/api/chat/presence', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error('Failed to load presence.');
    const data = await response.json();

    onlineList.innerHTML = '';

    const online = data.online || [];
    if (!online.length) {
      const li = document.createElement('li');
      li.textContent = 'No one online';
      onlineList.appendChild(li);
    } else {
      online.forEach((u) => {
        const li = document.createElement('li');
        li.textContent = u.username || u.userID;
        onlineList.appendChild(li);
      });
    }
  } catch (error) {
    console.error('❌ Failed to load presence:', error);
  }
}

function startChatPolling() {
  if (chatPollingIntervalId) return;
  chatPollingIntervalId = setInterval(() => {
    const chatSection = document.getElementById('chatSection');
    if (chatSection && chatSection.style.display === 'block') {
      loadChatMessages();
    }
  }, 500);
}

function startChatPresencePolling() {
  if (chatPresenceIntervalId) return;
  chatPresenceIntervalId = setInterval(() => {
    const chatSection = document.getElementById('chatSection');
    if (chatSection && chatSection.style.display === 'block') {
      pingChatPresence();
      loadChatPresence();
    }
  }, 10000);
}

function showSubmissionRewardModal(submission) {
  const existingModal = document.getElementById('submissionRewardModal');
  if (existingModal) existingModal.remove();

  const modalOverlay = document.createElement('div');
  modalOverlay.className = 'modal-overlay';
  modalOverlay.id = 'submissionRewardModal';

  const modalBox = document.createElement('div');
  modalBox.className = 'modal-box';
  modalBox.innerHTML = `
    <h2>Mark Quest Complete</h2>
    <p style="margin-bottom: 8px;">${submission.title}</p>
    <input type="number" id="rewardVoltsInput" placeholder="Volts to award" min="0" style="margin:6px 0; width: 100%; padding: 6px;">
    <div class="modal-buttons">
      <button class="confirm-button" id="confirmReward">Confirm</button>
      <button class="cancel-button" id="cancelReward">Cancel</button>
    </div>
  `;

  modalOverlay.appendChild(modalBox);
  document.body.appendChild(modalOverlay);

  const close = () => modalOverlay.remove();

  document.getElementById('cancelReward').addEventListener('click', close);
  document.getElementById('confirmReward').addEventListener('click', async () => {
    const rewardAmount = Number(document.getElementById('rewardVoltsInput').value);
    if (!Number.isFinite(rewardAmount) || rewardAmount < 0) {
      showConfirmationPopup('❌ Please enter a valid volts amount.');
      return;
    }

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/admin/submissions/${submission.submission_id}/complete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ rewardAmount }),
      });

      const result = await response.json();
      if (!response.ok) {
        showConfirmationPopup(`❌ ${result.message || 'Failed to complete submission.'}`);
        return;
      }

      close();
      showConfirmationPopup('✅ Submission marked complete.');
      loadAdminPage();
    } catch (error) {
      console.error('❌ Failed to complete submission:', error);
      showConfirmationPopup('❌ Failed to complete submission.');
    }
  });
}

async function fetchQuestStatus() {
  const token = localStorage.getItem('token');
  const questStatusValue = document.getElementById('questStatusValue');
  if (!token || !questStatusValue) return;

  try {
    const response = await fetch('/api/quest-status', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error('Failed to fetch quest status.');

    const data = await response.json();
    const statusMap = {
      no_quest: 'No Quest',
      active_quest: 'Active Quest',
      awaiting_submission: 'Waiting on admin to mark complete',
    };
    questStatusValue.textContent = `Quest Status: ${statusMap[data.status] || 'Unknown'}`;
  } catch (error) {
    console.error('❌ Failed to fetch quest status:', error);
    questStatusValue.textContent = 'Quest Status: Error';
  }
}

async function addAdminButton(userActionContainer, logoutButton) {
  try {
    const isAdmin = await checkCurrentUserIsAdmin();
    if (!isAdmin) return;

    const adminButton = document.createElement('button');
    adminButton.innerHTML = buildButtonIconMarkup('fa-solid fa-screwdriver-wrench', 'Admin');
    adminButton.className = 'btn text-sm font-bold';
    adminButton.style.height = '24px';
    adminButton.style.width = '110px';
    adminButton.style.lineHeight = '24px';
    adminButton.style.padding = '0 12px';
    adminButton.style.textAlign = 'center';

    adminButton.addEventListener('click', async () => {
      startAdminPolling();
      await openAdminSection(DEFAULT_ADMIN_PANEL);
    });

    if (logoutButton && userActionContainer.contains(logoutButton)) {
      userActionContainer.insertBefore(adminButton, logoutButton);
    } else {
      userActionContainer.appendChild(adminButton);
    }
  } catch (error) {
    console.error('❌ Failed to check admin status:', error);
  }
}

function buildButtonIconMarkup(iconClassNames, label) {
  return `<span class="btn-icon-content"><i class="${iconClassNames}" aria-hidden="true"></i><span>${label}</span></span>`;
}


/**
 * Replace the login form with 2 stacked buttons (INVENTORY + LOGOUT).
 */
function showPostLoginButtons() {
  console.log('🔄 Replacing login form with INVENTORY + LOGOUT buttons...');

  // Hide login inputs & labels
  const usernameInput = document.getElementById('loginUsername');
  const passwordInput = document.getElementById('loginPassword');
  const loginButton = document.getElementById('submitLogin');
  const discordLoginButton = document.getElementById('discordLoginButton');
  const usernameLabel = document.querySelector('label[for="loginUsername"]');
  const passwordLabel = document.querySelector('label[for="loginPassword"]');
  const voltMenuContainer = document.getElementById('voltMenuContainer');

  if (usernameInput) usernameInput.style.display = 'none';
  if (passwordInput) passwordInput.style.display = 'none';
  if (usernameLabel) usernameLabel.style.display = 'none';
  if (passwordLabel) passwordLabel.style.display = 'none';
  if (loginButton) loginButton.style.display = 'none';
  if (discordLoginButton) discordLoginButton.style.display = 'none';
  if (loginForm) loginForm.style.display = 'none';

  const loginModal = document.getElementById('loginModal');
  const loginModalCard = loginModal?.firstElementChild;
  if (loginModal) loginModal.classList.add('logged-in-mode');
  if (loginModalCard) loginModalCard.classList.add('logged-in-header');

  // Create a container for the two buttons, top-right corner
  const userActionContainer = document.createElement('div');
  userActionContainer.id = 'userButtons';
  userActionContainer.style.display = 'flex';
  userActionContainer.style.flexDirection = 'column';
  userActionContainer.style.alignItems = 'flex-end';
  userActionContainer.style.gap = '4px';

  // ========== USER AVATAR ==========
  const userAvatar = document.createElement('img');
  userAvatar.id = 'userActionAvatar';
  userAvatar.className = 'user-action-avatar';
  userAvatar.alt = 'Your Discord avatar';
  userActionContainer.appendChild(userAvatar);

  // ========== INVENTORY BUTTON ==========
  const inventoryButton = document.createElement('button');
  inventoryButton.innerHTML = buildButtonIconMarkup('fa-solid fa-box-open', 'Inventory');
  inventoryButton.className = 'btn text-sm font-bold';
  inventoryButton.style.height = '24px';
  inventoryButton.style.width = '110px'; // Ensure consistent width
  inventoryButton.style.lineHeight = '24px';
  inventoryButton.style.padding = '0 12px';
  inventoryButton.style.textAlign = 'center';

  // On click, fetch inventory & show the inventory page
  inventoryButton.addEventListener('click', () => {
    if (typeof fetchInventory === 'function') {
      fetchInventory();
    }
    if (typeof showSection === 'function') {
      showSection('inventorySection');
    }
  });

  // ========== USER PROFILE BUTTON ==========
  const userProfileButton = document.createElement('button');
  userProfileButton.innerHTML = buildButtonIconMarkup('fa-solid fa-user', 'Profile');
  userProfileButton.className = 'btn text-sm font-bold';
  userProfileButton.style.height = '24px';
  userProfileButton.style.width = '110px';
  userProfileButton.style.lineHeight = '24px';
  userProfileButton.style.padding = '0 12px';
  userProfileButton.style.textAlign = 'center';

  userProfileButton.addEventListener('click', () => {
    const localUserId = localStorage.getItem('discordUserID');
    const localUsername = localStorage.getItem('username');
    if (typeof showSection === 'function') {
      showSection('userProfileSection', {
        profileUserId: localUserId,
        profileRoutePath: localUsername
          ? `username/${encodeURIComponent(localUsername)}`
          : (localUserId ? encodeURIComponent(localUserId) : null),
      });
    }
    fetchUserHoldings();
    fetchVoltBalance();
    fetchQuestStatus();
  });

  // ========== CHAT BUTTON ==========
  const chatButton = document.createElement('button');
  chatButton.innerHTML = buildButtonIconMarkup('fa-solid fa-comments', 'Chat');
  chatButton.className = 'btn text-sm font-bold';
  chatButton.style.height = '24px';
  chatButton.style.width = '110px';
  chatButton.style.lineHeight = '24px';
  chatButton.style.padding = '0 12px';
  chatButton.style.textAlign = 'center';

  chatButton.addEventListener('click', () => {
    loadChatMessages();
    startChatPolling();
    pingChatPresence();
    loadChatPresence();
    startChatPresencePolling();
    if (typeof showSection === 'function') {
      showSection('chatSection');
    }
  });

  // ========== MAP BUTTON ==========
  const mapButton = document.createElement('button');
  mapButton.innerHTML = buildButtonIconMarkup('fa-solid fa-map', 'Map');
  mapButton.className = 'btn text-sm font-bold';
  mapButton.style.height = '24px';
  mapButton.style.width = '110px';
  mapButton.style.lineHeight = '24px';
  mapButton.style.padding = '0 12px';
  mapButton.style.textAlign = 'center';

  mapButton.addEventListener('click', () => {
    if (typeof showSection === 'function') {
      showSection('mapSection');
    }
    loadMemberMap();
  });

  // ========== LOGOUT BUTTON ==========
  const logoutButton = document.createElement('button');
  logoutButton.innerHTML = buildButtonIconMarkup('fa-solid fa-right-from-bracket', 'Logout');
  logoutButton.className = 'btn text-sm font-bold';
  logoutButton.style.height = '24px';
  logoutButton.style.width = '110px'; // Matches Inventory button width
  logoutButton.style.lineHeight = '24px';
  logoutButton.style.padding = '0 12px';
  logoutButton.style.textAlign = 'center';

  logoutButton.addEventListener('click', () => {
    console.log('🚪 Logging out...');
    localStorage.removeItem('token'); // Remove token
    localStorage.removeItem('discordUserID');
    location.reload(); // Reload page to reset UI
  });

  // Add both buttons to the container
  userActionContainer.appendChild(inventoryButton);
  userActionContainer.appendChild(userProfileButton);
  userActionContainer.appendChild(mapButton);
  userActionContainer.appendChild(chatButton);
  userActionContainer.appendChild(logoutButton);
  addAdminButton(userActionContainer, logoutButton);

  // Attach to the DOM
  if (voltMenuContainer && voltMenuContainer.parentNode) {
    voltMenuContainer.parentNode.insertBefore(userActionContainer, voltMenuContainer);
  } else {
    document.body.appendChild(userActionContainer);
  }

  const loggedInUserId = localStorage.getItem('discordUserID');
  hydrateUserAvatar(loggedInUserId, userAvatar);

  // ✅ Show the Volt menu only after login
  if (voltMenuContainer) voltMenuContainer.style.display = 'block';

  // Fetch the user's Volt balance
  fetchVoltBalance();
  fetchQuestStatus();
}

document.addEventListener('DOMContentLoaded', () => {
  const voltMenuContainer = document.getElementById('voltMenuContainer');
  const voltMenu = document.getElementById('voltMenu');
  const toggleVoltMenu = document.getElementById('toggleVoltMenu');

  // Hide Volt menu initially
  if (voltMenuContainer) voltMenuContainer.style.display = 'none';

  const token = localStorage.getItem('token');

  if (token) {
    console.log('✅ User is logged in, showing Volt menu.');
    if (voltMenuContainer) voltMenuContainer.style.display = 'block';

    if (toggleVoltMenu && voltMenu) {
      toggleVoltMenu.addEventListener('click', () => {
        console.log('🔄 Toggling Volt menu');
        voltMenu.style.display =
          voltMenu.style.display === 'block' ? 'none' : 'block';
      });
    }

    fetchVoltBalance(); // Fetch balance after login
  } else {
    console.log('🔒 User is not logged in, hiding Volt menu.');
  }
});

initAdminToggles();

async function loadSectionDataForRoute(sectionId, routeParts = []) {
  const routePath = routeParts.join('/');

  if (sectionId === 'leaderboard') {
    showLeaderboardButton?.click();
  } else if (sectionId === 'adminList') {
    showAdminListButton?.click();
  } else if (sectionId === 'shop') {
    showShopButton?.click();
  } else if (sectionId === 'rafflesSection') {
    showRafflesButton?.click();
  } else if (sectionId === 'jobList') {
    fetchJobs();
  } else if (sectionId === 'giveawayList') {
    fetchGiveaways();
  } else if (sectionId === 'dailyTasksPage') {
    startCountdownTimer();
  } else if (sectionId === 'consoleSection') {
    fetchAndDisplayConsoleLogs();
    startConsoleUpdates();
  } else if (sectionId === 'robotOilSection') {
    showRobotOilMarket();
  } else if (sectionId === 'inventorySection') {
    await fetchUserInventoryByProfileRoute(routePath);
  } else if (sectionId === 'mapSection') {
    loadMemberMap();
  } else if (sectionId === 'userProfileSection') {
    await fetchUserHoldingsByProfileRoute(routePath);
    fetchVoltBalance();
    fetchQuestStatus();
  } else if (sectionId === 'chatSection') {
    loadChatMessages({ forceScrollToBottom: true });
    startChatPolling();
    pingChatPresence();
    loadChatPresence();
    startChatPresencePolling();
  }
}

async function syncSectionFromHash() {
  if (!isLoggedIn()) {
    const pathRoute = getPathRouteState();
    const hashSection = HASH_TO_SECTION[window.location.hash.replace(/^#/, '').trim().split('/')[0] || ''];
    if (pathRoute || AUTH_REQUIRED_SECTIONS.has(hashSection)) {
      showSection('landingPage');
      return;
    }
  }

  const rawHash = window.location.hash.replace(/^#/, '').trim();
  if (!rawHash) {
    const pathRoute = getPathRouteState();
    if (pathRoute) {
      showSection(pathRoute.sectionId, {
        updateHash: false,
        profileRoutePath: pathRoute.sectionId === 'userProfileSection' && pathRoute.routeParts.length
          ? pathRoute.routeParts.join('/')
          : null,
        inventoryRoutePath: pathRoute.sectionId === 'inventorySection' && pathRoute.routeParts.length
          ? pathRoute.routeParts.join('/')
          : '',
      });

      await loadSectionDataForRoute(pathRoute.sectionId, pathRoute.routeParts);
      return;
    }
    showSection('landingPage');
    return;
  }
  const [sectionHash, ...routeParts] = rawHash.split('/');
  const routeArg = routeParts[0] || '';
  const normalizedHash = sectionHash || SECTION_HASHES.landingPage;
  const sectionId = HASH_TO_SECTION[normalizedHash];

  if (!sectionId) {
    showSection('landingPage');
    return;
  }

  if (sectionId === ADMIN_ROUTE_SECTION) {
    const panelId = HASH_TO_ADMIN_PANEL[routeArg] || DEFAULT_ADMIN_PANEL;
    const opened = await openAdminSection(panelId, { updateHash: false });
    if (opened) startAdminPolling();
    return;
  }

  showSection(sectionId, {
    updateHash: false,
    profileRoutePath: sectionId === 'userProfileSection' && routeParts.length
      ? routeParts.join('/')
      : null,
  });

  await loadSectionDataForRoute(sectionId, routeParts);
}

window.addEventListener('hashchange', () => {
  syncSectionFromHash();
});

async function fetchVoltBalance() {
  try {
    const token = localStorage.getItem("token");

    if (!token) {
      console.warn("🚨 No token found. User might not be logged in.");
      return;
    }

    const response = await fetch("/api/volt-balance", {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch Volt balance: ${response.statusText}`);
    }

    const { wallet, bank, totalBalance } = await response.json();
    const solarianBalanceEl = document.getElementById("solarianBalance");

    if (solarianBalanceEl) {
      solarianBalanceEl.textContent = `Volt Balance: ${totalBalance}`;
    }

    const userProfileSolarian = document.getElementById('userProfileSolarianValue');
    if (userProfileSolarian) {
      userProfileSolarian.textContent = `Volt Balance: ${totalBalance}`;
    }

    console.log("✅ Volt Balance Updated:", { wallet, bank, totalBalance });

  } catch (error) {
    console.error("❌ Error fetching Volt balance:", error);
    const solarianBalanceEl = document.getElementById("solarianBalance");
    if (solarianBalanceEl) {
      solarianBalanceEl.textContent = "Volt Balance: Error";
    }

    const userProfileSolarian = document.getElementById('userProfileSolarianValue');
    if (userProfileSolarian) {
      userProfileSolarian.textContent = 'Volt Balance: Error';
    }
  }
}

function safeText(value, fallback = 'Unknown') {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  return String(value);
}

async function parseResponsePayload(response) {
  const responseText = await response.text();
  if (!responseText) return {};

  try {
    return JSON.parse(responseText);
  } catch (error) {
    return {
      message: responseText.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() ||
        `Unexpected ${response.status} response from server.`,
    };
  }
}

function getProfileDetailValue(source, keys, fallback = 'Not provided yet.') {
  for (const key of keys) {
    const value = source?.[key];
    if (Array.isArray(value)) {
      const joinedValue = value
        .map((entry) => safeText(entry, '').trim())
        .filter(Boolean)
        .join(', ');
      if (joinedValue) return joinedValue;
      continue;
    }

    const normalizedValue = safeText(value, '').trim();
    if (normalizedValue) return normalizedValue;
  }
  return fallback;
}

function renderAboutMeHtml(value) {
  const normalizedValue = safeText(value, '').trim();
  if (!normalizedValue) return 'Not provided yet.';

  const urlPattern = /((?:https?:\/\/|www\.)[^\s<]+)/gi;
  const singleUrlPattern = /^(?:https?:\/\/|www\.)[^\s<]+$/i;
  return normalizedValue
    .split(urlPattern)
    .map((part) => {
      if (!part) return '';
      if (!singleUrlPattern.test(part)) {
        return escapeHtml(part);
      }

      const href = part.startsWith('www.') ? `https://${part}` : part;
      return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" class="link">${escapeHtml(part)}</a>`;
    })
    .join('');
}

function renderUserProfileDetails(holder) {
  const aboutMeEl = document.getElementById('userProfileAboutMe');
  const specialtiesEl = document.getElementById('userProfileSpecialties');
  const locationEl = document.getElementById('userProfileLocation');
  const username = safeText(holder?.username, '').trim();
  const aboutMe = getProfileDetailValue(
    holder,
    ['aboutMe', 'about', 'about_me', 'bio', 'description'],
    ''
  );
  const specialties = getProfileDetailValue(
    holder,
    ['specialties', 'specialty', 'skills', 'interests'],
    ''
  );
  const location = getProfileDetailValue(
    holder,
    ['location', 'city', 'country', 'region'],
    ''
  );

  currentProfileDetails = { username, aboutMe, specialties, location };

  if (aboutMeEl) {
    aboutMeEl.innerHTML = renderAboutMeHtml(aboutMe);
  }

  if (specialtiesEl) {
    specialtiesEl.textContent = specialties || 'Not provided yet.';
  }

  if (locationEl) {
    locationEl.textContent = location || 'Not provided yet.';
  }
}

function syncEditProfileButtonVisibility() {
  const editButton = document.getElementById('editUserProfileButton');
  if (!editButton) return;

  const localUserId = localStorage.getItem('discordUserID');
  const canEdit = Boolean(localUserId && currentProfileUserId && currentProfileUserId === localUserId);
  editButton.style.display = canEdit ? 'inline-flex' : 'none';
}

function getProfileCountryOptions() {
  if (profileCountryOptionsCache) return profileCountryOptionsCache;

  const countries = [...PROFILE_COUNTRY_OPTIONS];

  try {
    if (typeof Intl?.supportedValuesOf === 'function' && typeof Intl?.DisplayNames === 'function') {
      const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
      const intlCountries = Intl.supportedValuesOf('region')
        .filter((regionCode) => /^[A-Z]{2}$/.test(regionCode))
        .map((regionCode) => regionNames.of(regionCode))
        .filter(Boolean);
      countries.push(...intlCountries);
    }
  } catch (error) {
    console.warn('Using built-in country list for profile options:', error);
  }

  profileCountryOptionsCache = [...new Set(countries)].sort((left, right) => left.localeCompare(right));
  return profileCountryOptionsCache;
}

function closeEditProfileModal() {
  const modal = document.getElementById('editProfileModal');
  if (modal) modal.remove();
}

async function submitProfileUpdate(event) {
  event.preventDefault();

  const token = localStorage.getItem('token');
  if (!token) {
    alert('You must be logged in to update your profile.');
    return;
  }

  const form = event.currentTarget;
  const submitButton = document.getElementById('submitProfileUpdateButton');
  const payload = {
    username: form.querySelector('[name="username"]')?.value || '',
    aboutMe: form.querySelector('[name="aboutMe"]')?.value || '',
    specialties: form.querySelector('[name="specialties"]')?.value || '',
    location: form.querySelector('[name="location"]')?.value || '',
  };

  if (submitButton) submitButton.disabled = true;

  try {
    const response = await fetch('/api/profile', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
    const result = await parseResponsePayload(response);

    if (!response.ok) {
      throw new Error(result.message || 'Failed to update profile.');
    }

    const updatedUsername = safeText(result.profile?.username, payload.username).trim();
    const updatedRoutePath = buildUsernameRoutePath(updatedUsername, currentProfileUserId);
    if (result.token) {
      localStorage.setItem('token', result.token);
    }
    localStorage.setItem('username', updatedUsername);
    currentProfileUsername = updatedUsername || currentProfileUsername;
    currentProfileRoutePath = updatedRoutePath;
    const profileTitle = document.getElementById('userProfileTitle');
    if (profileTitle) {
      profileTitle.textContent = `${updatedUsername || 'User'}'s Profile`;
    }
    renderUserProfileDetails(result.profile || payload);
    setSectionHash('userProfileSection', null, updatedRoutePath);
    closeEditProfileModal();
    showConfirmationPopup('✅ Profile updated successfully!');
  } catch (error) {
    console.error('Error updating profile:', error);
    showConfirmationPopup(`❌ ${error.message || 'Failed to update profile.'}`);
  } finally {
    if (submitButton) submitButton.disabled = false;
  }
}

function openEditProfileModal() {
  closeEditProfileModal();

  const modalOverlay = document.createElement('div');
  modalOverlay.className = 'modal-overlay';
  modalOverlay.id = 'editProfileModal';

  const modalBox = document.createElement('div');
  modalBox.className = 'modal-box edit-profile-modal-box';

  const profileCountries = getProfileCountryOptions();
  const currentLocation = safeText(currentProfileDetails.location, '').trim();
  const countryOptions = (currentLocation && !profileCountries.includes(currentLocation)
    ? [...profileCountries, currentLocation].sort((left, right) => left.localeCompare(right))
    : profileCountries)
    .map((country) => {
      const selected = country === currentLocation ? 'selected' : '';
      return `<option value="${escapeHtml(country)}" ${selected}>${escapeHtml(country)}</option>`;
    })
    .join('');

  modalBox.innerHTML = `
    <h2>Edit Profile</h2>
    <form id="editProfileForm" class="edit-profile-form">
      <div>
        <label class="edit-profile-label" for="editProfileUsername">Display Name</label>
        <input
          id="editProfileUsername"
          name="username"
          class="edit-profile-control"
          type="text"
          maxlength="32"
          value="${escapeHtml(currentProfileDetails.username)}"
          placeholder="Choose your public Volt name"
        />
      </div>
      <div>
        <label class="edit-profile-label" for="editProfileAboutMe">About Me</label>
        <textarea
          id="editProfileAboutMe"
          name="aboutMe"
          class="edit-profile-control edit-profile-textarea"
          maxlength="500"
          placeholder="Share a short intro..."
        >${escapeHtml(currentProfileDetails.aboutMe)}</textarea>
      </div>
      <div>
        <label class="edit-profile-label" for="editProfileSpecialties">Specialties</label>
        <input
          id="editProfileSpecialties"
          name="specialties"
          class="edit-profile-control"
          type="text"
          maxlength="250"
          value="${escapeHtml(currentProfileDetails.specialties)}"
          placeholder="Builder, artist, trader..."
        />
      </div>
      <div>
        <label class="edit-profile-label" for="editProfileLocation">Country</label>
        <select id="editProfileLocation" name="location" class="edit-profile-control">
          <option value="">Select Country</option>
          ${countryOptions}
        </select>
      </div>
      <div class="modal-buttons">
        <button type="submit" id="submitProfileUpdateButton" class="confirm-button">${buildButtonIconMarkup('fa-solid fa-floppy-disk', 'Save Profile')}</button>
        <button type="button" id="cancelProfileEditButton" class="cancel-button">${buildButtonIconMarkup('fa-solid fa-ban', 'Cancel')}</button>
      </div>
    </form>
  `;

  modalOverlay.appendChild(modalBox);
  document.body.appendChild(modalOverlay);

  document.getElementById('cancelProfileEditButton')?.addEventListener('click', closeEditProfileModal);
  document.getElementById('editProfileForm')?.addEventListener('submit', submitProfileUpdate);
  modalOverlay.addEventListener('click', (event) => {
    if (event.target === modalOverlay) closeEditProfileModal();
  });
}

function getCountryMapPosition(countryName) {
  const normalizedCountry = safeText(countryName, '').trim();
  return PROFILE_COUNTRY_COORDS[normalizedCountry] || null;
}

async function getCountryLatLngLookup() {
  if (profileCountryLatLngCache) return profileCountryLatLngCache;

  profileCountryLatLngCache = { ...PROFILE_COUNTRY_COORDS };
  profileCountryAreaCache = { ...PROFILE_COUNTRY_AREAS };

  try {
    const response = await fetch('https://restcountries.com/v3.1/all?fields=name,latlng,area');
    if (!response.ok) {
      throw new Error(`Failed to load country coordinates: ${response.statusText}`);
    }

    const countries = await response.json();
    (countries || []).forEach((country) => {
      const latlng = Array.isArray(country?.latlng) ? country.latlng : null;
      const lat = Number(latlng?.[0]);
      const lng = Number(latlng?.[1]);
      const area = Number(country?.area);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

      if (country?.name?.common) {
        profileCountryLatLngCache[country.name.common] = { lat, lng };
        if (Number.isFinite(area) && area > 0) {
          profileCountryAreaCache[country.name.common] = area;
        }
      }
      if (country?.name?.official) {
        profileCountryLatLngCache[country.name.official] = { lat, lng };
        if (Number.isFinite(area) && area > 0) {
          profileCountryAreaCache[country.name.official] = area;
        }
      }
    });
  } catch (error) {
    console.warn('Using fallback member map country coordinates:', error);
  }

  return profileCountryLatLngCache;
}

function closeMemberMapCard() {
  document.getElementById('memberMapCard')?.remove();
}

function isMemberMapFullscreenActive() {
  const mapShell = document.getElementById('memberMapShell');
  return Boolean(mapShell?.classList.contains('is-fullscreen-fallback'));
}

function updateMemberMapFullscreenButton() {
  const fullscreenButton = document.getElementById('memberMapFullscreenButton');
  if (!fullscreenButton) return;

  const isExpanded = isMemberMapFullscreenActive();
  fullscreenButton.innerHTML = buildButtonIconMarkup(
    isExpanded ? 'fa-solid fa-compress' : 'fa-solid fa-expand',
    isExpanded ? 'Collapse Map' : 'Expand Map'
  );
  fullscreenButton.setAttribute('aria-label', isExpanded ? 'Collapse map' : 'Expand map');
}

function refreshMemberMapLayout() {
  if (!memberMapInstance) return;
  window.requestAnimationFrame(() => {
    memberMapInstance.invalidateSize();
  });
}

async function exitMemberMapFullscreen() {
  const mapShell = document.getElementById('memberMapShell');
  if (!mapShell) return;

  mapShell.classList.remove('is-fullscreen-fallback');
  updateMemberMapFullscreenButton();
  refreshMemberMapLayout();
}

async function toggleMemberMapFullscreen() {
  const mapShell = document.getElementById('memberMapShell');
  if (!mapShell) return;

  const isExpanded = isMemberMapFullscreenActive();
  if (isExpanded) {
    await exitMemberMapFullscreen();
    return;
  }

  mapShell.classList.add('is-fullscreen-fallback');

  updateMemberMapFullscreenButton();
  refreshMemberMapLayout();
}

function bringMemberMapMarkerToFront(marker) {
  if (!marker || typeof marker.setZIndexOffset !== 'function') return;

  memberMapTopMarkerZIndex += 10000;
  marker.setZIndexOffset(memberMapTopMarkerZIndex);
}

function getMemberMapSpreadScale(countryName) {
  const normalizedCountry = safeText(countryName, '').trim();
  const area = Number(profileCountryAreaCache?.[normalizedCountry]);
  if (!Number.isFinite(area) || area <= 0) return 1.15;

  if (area >= 7000000) return 2.6;
  if (area >= 3000000) return 2.2;
  if (area >= 1000000) return 1.85;
  if (area >= 400000) return 1.55;
  if (area >= 150000) return 1.3;
  if (area >= 50000) return 1.1;
  return 0.95;
}

function getMemberMapMaxSpreadKm(countryName) {
  const normalizedCountry = safeText(countryName, '').trim();
  const area = Number(profileCountryAreaCache?.[normalizedCountry]);
  if (!Number.isFinite(area) || area <= 0) return 180;

  const countryRadiusKm = Math.sqrt(area / Math.PI);
  return Math.max(40, Math.min(420, countryRadiusKm * 0.28));
}

function getMemberMapMarkerPosition(basePosition, countryName, countryIndex, countryCount) {
  if (!basePosition || !memberMapInstance || countryCount <= 1) return basePosition;

  const spreadScale = getMemberMapSpreadScale(countryName);
  const maxSpreadKm = getMemberMapMaxSpreadKm(countryName);
  const maxLatitude = 84;
  const goldenAngle = 2.399963229728653;
  const angle = (-Math.PI / 2) + (countryIndex * goldenAngle);
  const normalizedIndex = countryCount > 1
    ? Math.sqrt((countryIndex + 0.5) / countryCount)
    : 0;
  const radialDistanceKm = maxSpreadKm * normalizedIndex * spreadScale;
  const latitudeRadians = (basePosition.lat * Math.PI) / 180;
  const kmPerLatDegree = 110.574;
  const kmPerLngDegree = Math.max(111.320 * Math.cos(latitudeRadians), 12);
  const latOffset = (Math.sin(angle) * radialDistanceKm) / kmPerLatDegree;
  const lngOffset = (Math.cos(angle) * radialDistanceKm) / kmPerLngDegree;

  return {
    lat: Math.max(-maxLatitude, Math.min(maxLatitude, basePosition.lat + latOffset)),
    lng: L.Util.wrapNum(basePosition.lng + lngOffset, [-180, 180], true),
  };
}

function openMemberMapCard(user) {
  const mapCanvas = document.getElementById('memberMapCanvas');
  if (!mapCanvas || !user) return;

  closeMemberMapCard();

  const card = document.createElement('div');
  card.id = 'memberMapCard';
  card.className = 'member-map-card';
  card.innerHTML = `
    <div class="member-map-card-header">
      <img class="member-map-card-avatar" alt="Discord avatar" />
      <div>
        <h3 class="member-map-card-name">${escapeHtml(user.username || user.userID || 'User')}</h3>
        <div class="member-map-card-location">${escapeHtml(user.location || 'Unknown')}</div>
      </div>
    </div>
    <div class="member-map-card-actions">
      <button type="button" id="memberMapViewProfileButton" class="btn text-sm font-bold">${buildButtonIconMarkup('fa-solid fa-address-card', 'View Profile')}</button>
      <button type="button" id="memberMapCloseCardButton" class="btn text-sm font-bold">${buildButtonIconMarkup('fa-solid fa-xmark', 'Close')}</button>
    </div>
  `;

  mapCanvas.appendChild(card);
  hydrateUserAvatar(user.userID, card.querySelector('.member-map-card-avatar'));

  document.getElementById('memberMapCloseCardButton')?.addEventListener('click', closeMemberMapCard);
  document.getElementById('memberMapViewProfileButton')?.addEventListener('click', () => {
    closeMemberMapCard();
    if (typeof showSection === 'function') {
      showSection('userProfileSection', {
        profileUserId: user.userID,
        profileRoutePath: user.username
          ? `username/${encodeURIComponent(user.username)}`
          : encodeURIComponent(user.userID),
      });
    }
    fetchUserHoldingsFor(user.userID);
    fetchVoltBalance();
    fetchQuestStatus();
  });
}

async function renderMemberMap(users) {
  const mapCanvas = document.getElementById('memberMapCanvas');
  const mapStatus = document.getElementById('memberMapStatus');
  if (!mapCanvas) return;

  if (typeof L === 'undefined') {
    if (mapStatus) {
      mapStatus.textContent = 'Interactive map library failed to load.';
    }
    return;
  }

  if (!memberMapInstance) {
    memberMapInstance = L.map('memberMapCanvas', {
      worldCopyJump: true,
      minZoom: 1,
      maxZoom: 8,
      zoomSnap: 0.25,
      zoomDelta: 0.5,
      zoomControl: true,
      maxBounds: [[-85, -180], [85, 180]],
      maxBoundsViscosity: 0.35,
    }).fitBounds([[-58, -180], [85, 180]], {
      padding: [24, 24],
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors',
    }).addTo(memberMapInstance);

    memberMapMarkersLayer = L.layerGroup().addTo(memberMapInstance);
    memberMapInstance.on('click', closeMemberMapCard);
    memberMapInstance.on('zoomend', () => {
      if (currentMapUsers.length) {
        renderMemberMap(currentMapUsers);
      }
    });
  }

  if (!memberMapFullscreenListenersBound) {
    document.getElementById('memberMapFullscreenButton')?.addEventListener('click', toggleMemberMapFullscreen);
    window.addEventListener('resize', refreshMemberMapLayout);
    memberMapFullscreenListenersBound = true;
  }

  memberMapInstance.invalidateSize();
  memberMapMarkersLayer.clearLayers();
  closeMemberMapCard();
  updateMemberMapFullscreenButton();

  const countryLookup = await getCountryLatLngLookup();
  const usersByCountry = new Map();

  (users || []).forEach((user) => {
    const countryName = safeText(user.location, '').trim();
    const position = countryLookup[countryName] || getCountryMapPosition(countryName);
    if (!position) return;

    if (!usersByCountry.has(countryName)) {
      usersByCountry.set(countryName, []);
    }
    usersByCountry.get(countryName).push({ user, position });
  });

  let renderedCount = 0;
  usersByCountry.forEach((countryUsers, countryName) => {
    countryUsers.forEach(({ user, position }, countryIndex) => {
      const markerPosition = getMemberMapMarkerPosition(position, countryName, countryIndex, countryUsers.length);
      const marker = L.marker(
        [markerPosition.lat, markerPosition.lng],
        {
          icon: L.divIcon({
            className: 'member-map-pin',
            iconSize: [38, 54],
            iconAnchor: [19, 54],
            html: `
              <img class="member-map-pin-avatar" alt="${escapeHtml(user.username || 'User')}" />
              <span class="member-map-pin-stem"></span>
            `,
          }),
        }
      );
      marker.on('mouseover', () => bringMemberMapMarkerToFront(marker));
      marker.on('focus', () => bringMemberMapMarkerToFront(marker));
      marker.on('click', () => openMemberMapCard(user));
      marker.addTo(memberMapMarkersLayer);
      const pinEl = marker.getElement();
      if (pinEl) {
        hydrateUserAvatar(user.userID, pinEl.querySelector('.member-map-pin-avatar'));
      } else {
        marker.once('add', () => {
          hydrateUserAvatar(user.userID, marker.getElement()?.querySelector('.member-map-pin-avatar'));
        });
      }
      renderedCount += 1;
    });
  });

  if (mapStatus) {
    mapStatus.textContent = renderedCount
      ? `Showing ${renderedCount} mapped member${renderedCount === 1 ? '' : 's'}.`
      : 'No members have added a supported country yet.';
  }
}

async function loadMemberMap() {
  const mapStatus = document.getElementById('memberMapStatus');
  if (mapStatus) mapStatus.textContent = 'Loading map pins...';

  updateMemberMapFullscreenButton();

  try {
    const response = await fetch('/api/profile-map', {
      headers: getAuthHeaders(),
    });
    const users = await parseResponsePayload(response);
    if (!response.ok) {
      throw new Error(users.message || 'Failed to load map users.');
    }
    currentMapUsers = Array.isArray(users) ? users : [];
    await renderMemberMap(currentMapUsers);
  } catch (error) {
    console.error('Error loading member map:', error);
    if (mapStatus) {
      mapStatus.textContent = 'Could not load member map.';
    }
  }
}

async function fetchDiscordUserMeta(userId) {
  if (!userId) return null;
  try {
    const res = await fetch(`/api/discord-user/${userId}`, {
      headers: getAuthHeaders(),
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch Discord user meta: ${res.statusText}`);
    }
    return await res.json();
  } catch (error) {
    console.error('Error fetching Discord user meta:', error);
    return null;
  }
}

function applyAvatarImage(imgEl, url) {
  if (!imgEl) return;
  if (url) {
    imgEl.src = url;
    imgEl.style.display = 'block';
  } else {
    imgEl.removeAttribute('src');
    imgEl.style.display = 'none';
  }
}

async function hydrateUserAvatar(userId, imgEl, tagEl) {
  if (!userId) {
    applyAvatarImage(imgEl, null);
    if (tagEl) tagEl.textContent = '';
    return;
  }
  const meta = await fetchDiscordUserMeta(userId);
  applyAvatarImage(imgEl, meta?.avatarUrl || null);
  if (tagEl) {
    tagEl.textContent = meta?.tag ? `@${meta.tag}` : '';
  }
}

let currentUserTokens = [];
let currentProfileUserId = null;
let currentProfileUsername = null;
let currentProfileRoutePath = null;
let currentInventoryRoutePath = null;
let solarianMosaicImageObserver = null;
const solarianImageLoadCache = new Map();
const solarianImagePreloadQueue = [];
const solarianImagePreloadQueuedUrls = new Set();
const SOLARIAN_IMAGE_PRELOAD_CONCURRENCY = 4;
let solarianImagePreloadActiveCount = 0;
let currentSolarianMosaicTokens = [];
let currentSolarianMosaicRenderedCount = 0;
const solarianMosaicLoadQueue = [];
let solarianMosaicActiveLoadCount = 0;
let currentProfileDetails = {
  aboutMe: '',
  specialties: '',
  location: '',
};
let profileCountryOptionsCache = null;
let currentMapUsers = [];
let memberMapInstance = null;
let memberMapMarkersLayer = null;
let memberMapTopMarkerZIndex = 0;
let memberMapFullscreenListenersBound = false;
let profileCountryLatLngCache = null;
let profileCountryAreaCache = null;
const PROFILE_COUNTRY_OPTIONS = [
  'Afghanistan',
  'Albania',
  'Algeria',
  'American Samoa',
  'Andorra',
  'Angola',
  'Anguilla',
  'Antarctica',
  'Antigua and Barbuda',
  'Argentina',
  'Armenia',
  'Aruba',
  'Australia',
  'Austria',
  'Azerbaijan',
  'Bahamas',
  'Bahrain',
  'Bangladesh',
  'Barbados',
  'Belarus',
  'Belgium',
  'Belize',
  'Benin',
  'Bermuda',
  'Bhutan',
  'Bolivia',
  'Bosnia and Herzegovina',
  'Botswana',
  'Bouvet Island',
  'Brazil',
  'British Indian Ocean Territory',
  'Brunei',
  'Bulgaria',
  'Burkina Faso',
  'Burundi',
  'Cambodia',
  'Cameroon',
  'Canada',
  'Cape Verde',
  'Caribbean Netherlands',
  'Cayman Islands',
  'Central African Republic',
  'Chad',
  'Chile',
  'China',
  'Christmas Island',
  'Cocos (Keeling) Islands',
  'Colombia',
  'Comoros',
  'Congo',
  'Cook Islands',
  'Costa Rica',
  "Cote d'Ivoire",
  'Croatia',
  'Cuba',
  'Curacao',
  'Cyprus',
  'Czechia',
  'Democratic Republic of the Congo',
  'Denmark',
  'Djibouti',
  'Dominica',
  'Dominican Republic',
  'Ecuador',
  'Egypt',
  'El Salvador',
  'Equatorial Guinea',
  'Eritrea',
  'Estonia',
  'Eswatini',
  'Ethiopia',
  'Falkland Islands',
  'Faroe Islands',
  'Fiji',
  'Finland',
  'France',
  'French Guiana',
  'French Polynesia',
  'French Southern Territories',
  'Gabon',
  'Gambia',
  'Georgia',
  'Germany',
  'Ghana',
  'Gibraltar',
  'Greece',
  'Greenland',
  'Grenada',
  'Guadeloupe',
  'Guam',
  'Guatemala',
  'Guernsey',
  'Guinea',
  'Guinea-Bissau',
  'Guyana',
  'Haiti',
  'Heard Island and McDonald Islands',
  'Honduras',
  'Hong Kong',
  'Hungary',
  'Iceland',
  'India',
  'Indonesia',
  'Iran',
  'Iraq',
  'Ireland',
  'Isle of Man',
  'Israel',
  'Italy',
  'Jamaica',
  'Japan',
  'Jersey',
  'Jordan',
  'Kazakhstan',
  'Kenya',
  'Kiribati',
  'Kosovo',
  'Kuwait',
  'Kyrgyzstan',
  'Laos',
  'Latvia',
  'Lebanon',
  'Lesotho',
  'Liberia',
  'Libya',
  'Liechtenstein',
  'Lithuania',
  'Luxembourg',
  'Macao',
  'Madagascar',
  'Malawi',
  'Malaysia',
  'Maldives',
  'Mali',
  'Malta',
  'Marshall Islands',
  'Martinique',
  'Mauritania',
  'Mauritius',
  'Mayotte',
  'Mexico',
  'Micronesia',
  'Moldova',
  'Monaco',
  'Mongolia',
  'Montenegro',
  'Montserrat',
  'Morocco',
  'Mozambique',
  'Myanmar',
  'Namibia',
  'Nauru',
  'Nepal',
  'Netherlands',
  'New Caledonia',
  'New Zealand',
  'Nicaragua',
  'Niger',
  'Nigeria',
  'Niue',
  'Norfolk Island',
  'North Korea',
  'North Macedonia',
  'Northern Mariana Islands',
  'Norway',
  'Oman',
  'Pakistan',
  'Palau',
  'Palestine',
  'Panama',
  'Papua New Guinea',
  'Paraguay',
  'Peru',
  'Philippines',
  'Pitcairn Islands',
  'Poland',
  'Portugal',
  'Puerto Rico',
  'Qatar',
  'Reunion',
  'Romania',
  'Russia',
  'Rwanda',
  'Saint Barthelemy',
  'Saint Helena, Ascension and Tristan da Cunha',
  'Saint Kitts and Nevis',
  'Saint Lucia',
  'Saint Martin',
  'Saint Pierre and Miquelon',
  'Saint Vincent and the Grenadines',
  'Samoa',
  'San Marino',
  'Sao Tome and Principe',
  'Saudi Arabia',
  'Senegal',
  'Serbia',
  'Seychelles',
  'Sierra Leone',
  'Singapore',
  'Sint Maarten',
  'Slovakia',
  'Slovenia',
  'Solomon Islands',
  'Somalia',
  'South Africa',
  'South Georgia and the South Sandwich Islands',
  'South Korea',
  'South Sudan',
  'Spain',
  'Sri Lanka',
  'Sudan',
  'Suriname',
  'Svalbard and Jan Mayen',
  'Sweden',
  'Switzerland',
  'Syria',
  'Taiwan',
  'Tajikistan',
  'Tanzania',
  'Thailand',
  'Timor-Leste',
  'Togo',
  'Tokelau',
  'Tonga',
  'Trinidad and Tobago',
  'Tunisia',
  'Turkey',
  'Turkmenistan',
  'Turks and Caicos Islands',
  'Tuvalu',
  'Uganda',
  'Ukraine',
  'United Arab Emirates',
  'United Kingdom',
  'United States',
  'United States Minor Outlying Islands',
  'Uruguay',
  'Uzbekistan',
  'Vanuatu',
  'Vatican City',
  'Venezuela',
  'Vietnam',
  'Virgin Islands, British',
  'Virgin Islands, U.S.',
  'Wallis and Futuna',
  'Western Sahara',
  'Yemen',
  'Zambia',
  'Zimbabwe',
  'Aland Islands',
];

const PROFILE_COUNTRY_COORDS = {
  'United States': { lat: 39.8, lng: -98.6 },
  Canada: { lat: 56.1, lng: -106.3 },
  Mexico: { lat: 23.6, lng: -102.6 },
  Brazil: { lat: -14.2, lng: -51.9 },
  Argentina: { lat: -38.4, lng: -63.6 },
  'United Kingdom': { lat: 55.4, lng: -3.4 },
  Ireland: { lat: 53.4, lng: -8.2 },
  France: { lat: 46.2, lng: 2.2 },
  Spain: { lat: 40.5, lng: -3.7 },
  Portugal: { lat: 39.4, lng: -8.2 },
  Germany: { lat: 51.2, lng: 10.5 },
  Netherlands: { lat: 52.1, lng: 5.3 },
  Italy: { lat: 41.9, lng: 12.6 },
  Sweden: { lat: 60.1, lng: 18.6 },
  Norway: { lat: 60.5, lng: 8.5 },
  Poland: { lat: 51.9, lng: 19.1 },
  Ukraine: { lat: 48.4, lng: 31.2 },
  Turkey: { lat: 39.0, lng: 35.2 },
  Egypt: { lat: 26.8, lng: 30.8 },
  Nigeria: { lat: 9.1, lng: 8.7 },
  'South Africa': { lat: -30.6, lng: 22.9 },
  India: { lat: 20.6, lng: 78.9 },
  China: { lat: 35.9, lng: 104.2 },
  Japan: { lat: 36.2, lng: 138.3 },
  'South Korea': { lat: 36.5, lng: 127.8 },
  Philippines: { lat: 12.9, lng: 121.8 },
  Indonesia: { lat: -0.8, lng: 113.9 },
  Singapore: { lat: 1.35, lng: 103.82 },
  Thailand: { lat: 15.8, lng: 100.9 },
  Vietnam: { lat: 14.1, lng: 108.3 },
  Australia: { lat: -25.3, lng: 133.8 },
  'New Zealand': { lat: -40.9, lng: 174.9 },
};

const PROFILE_COUNTRY_AREAS = {
  'United States': 9833517,
  Canada: 9984670,
  Mexico: 1964375,
  Brazil: 8515767,
  Argentina: 2780400,
  'United Kingdom': 242900,
  Ireland: 70273,
  France: 551695,
  Spain: 505992,
  Portugal: 92212,
  Germany: 357114,
  Netherlands: 41850,
  Italy: 301340,
  Sweden: 450295,
  Norway: 385207,
  Poland: 312696,
  Ukraine: 603500,
  Turkey: 783562,
  Egypt: 1002450,
  Nigeria: 923768,
  'South Africa': 1221037,
  India: 3287263,
  China: 9596961,
  Japan: 377975,
  'South Korea': 100210,
  Philippines: 300000,
  Indonesia: 1904569,
  Singapore: 734,
  Thailand: 513120,
  Vietnam: 331212,
  Australia: 7692024,
  'New Zealand': 268838,
};

function applySolarianImageSource(imgEl, imageUrl, loadingClassName = null) {
  if (!imgEl || !imageUrl) return;

  const markLoaded = () => {
    solarianImageLoadCache.set(imageUrl, true);
    if (loadingClassName) {
      imgEl.classList.remove(loadingClassName, 'is-error');
    }
  };

  if (solarianImageLoadCache.get(imageUrl)) {
    imgEl.src = imageUrl;
    markLoaded();
    return;
  }

  if (loadingClassName) {
    imgEl.classList.add(loadingClassName);
  }

  imgEl.addEventListener('load', markLoaded, { once: true });
  imgEl.addEventListener('error', () => {
    if (loadingClassName) {
      imgEl.classList.remove(loadingClassName);
      imgEl.classList.add('is-error');
    }
  }, { once: true });
  imgEl.src = imageUrl;
}

function pumpSolarianImagePreloadQueue() {
  while (
    solarianImagePreloadActiveCount < SOLARIAN_IMAGE_PRELOAD_CONCURRENCY &&
    solarianImagePreloadQueue.length
  ) {
    const imageUrl = solarianImagePreloadQueue.shift();
    if (!imageUrl || solarianImageLoadCache.get(imageUrl)) {
      solarianImagePreloadQueuedUrls.delete(imageUrl);
      continue;
    }

    solarianImagePreloadActiveCount += 1;
    const preloadImage = new Image();

    const finishPreload = () => {
      solarianImagePreloadActiveCount = Math.max(0, solarianImagePreloadActiveCount - 1);
      solarianImagePreloadQueuedUrls.delete(imageUrl);
      pumpSolarianImagePreloadQueue();
    };

    preloadImage.addEventListener('load', () => {
      solarianImageLoadCache.set(imageUrl, true);
      finishPreload();
    }, { once: true });
    preloadImage.addEventListener('error', finishPreload, { once: true });
    preloadImage.src = imageUrl;
  }
}

function queueSolarianImagePreloads(tokens) {
  if (!Array.isArray(tokens) || !tokens.length) return;

  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1024;
  const isSmallScreen = viewportWidth <= 700;
  if (isSmallScreen && tokens.length > 20) {
    return;
  }

  tokens.forEach((token) => {
    const imageUrl = token?.metadata?.image;
    if (
      !imageUrl ||
      solarianImageLoadCache.get(imageUrl) ||
      solarianImagePreloadQueuedUrls.has(imageUrl)
    ) {
      return;
    }

    solarianImagePreloadQueuedUrls.add(imageUrl);
    solarianImagePreloadQueue.push(imageUrl);
  });

  pumpSolarianImagePreloadQueue();
}

function getSolarianMosaicBatchSize(totalCount = 0) {
  if (totalCount <= 20) return totalCount;

  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1024;
  const isSmallScreen = viewportWidth <= 700;
  return isSmallScreen ? 12 : 30;
}

function getSolarianMosaicLoadConcurrency() {
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 1024;
  return viewportWidth <= 700 ? 2 : 6;
}

function pumpSolarianMosaicLoadQueue() {
  const maxConcurrentLoads = getSolarianMosaicLoadConcurrency();

  while (solarianMosaicActiveLoadCount < maxConcurrentLoads && solarianMosaicLoadQueue.length) {
    const img = solarianMosaicLoadQueue.shift();
    const sourceUrl = img?.dataset?.src;
    if (!img || !sourceUrl || img.dataset.loaded === '1') {
      continue;
    }

    img.dataset.loaded = '1';
    solarianMosaicActiveLoadCount += 1;

    const finishLoad = () => {
      solarianMosaicActiveLoadCount = Math.max(0, solarianMosaicActiveLoadCount - 1);
      pumpSolarianMosaicLoadQueue();
    };

    if (solarianImageLoadCache.get(sourceUrl)) {
      img.src = sourceUrl;
      img.classList.remove('is-loading', 'is-error');
      finishLoad();
      continue;
    }

    img.classList.add('is-loading');
    const preloadImage = new Image();
    preloadImage.addEventListener('load', () => {
      solarianImageLoadCache.set(sourceUrl, true);
      img.src = sourceUrl;
      img.classList.remove('is-loading', 'is-error');
      finishLoad();
    }, { once: true });
    preloadImage.addEventListener('error', () => {
      img.classList.remove('is-loading');
      img.classList.add('is-error');
      finishLoad();
    }, { once: true });
    preloadImage.decoding = 'async';
    preloadImage.src = sourceUrl;
  }
}

function maybeAppendSolarianMosaicBatch(mosaicGrid, force = false) {
  if (!mosaicGrid) return;

  const totalCount = currentSolarianMosaicTokens.length;
  if (!totalCount || currentSolarianMosaicRenderedCount >= totalCount) return;

  const remaining = totalCount - currentSolarianMosaicRenderedCount;
  const batchSize = getSolarianMosaicBatchSize(totalCount);
  const shouldAppend =
    force ||
    currentSolarianMosaicRenderedCount === 0 ||
    (mosaicGrid.scrollTop + mosaicGrid.clientHeight >= mosaicGrid.scrollHeight - 320);

  if (!shouldAppend) return;

  const fragment = document.createDocumentFragment();
  const nextTokens = currentSolarianMosaicTokens.slice(
    currentSolarianMosaicRenderedCount,
    currentSolarianMosaicRenderedCount + Math.min(batchSize, remaining)
  );

  const loadMosaicImage = (img) => {
    const sourceUrl = img.dataset.src;
    if (!sourceUrl || img.dataset.loaded === '1') return;
    img.dataset.loaded = '1';
    applySolarianImageSource(img, sourceUrl, 'is-loading');
  };

  nextTokens.forEach((token) => {
    if (!token?.metadata?.image) return;
    const img = document.createElement('img');
    img.dataset.src = token.metadata.image;
    img.alt = 'Solarian';
    img.className = 'solarian-mosaic-image';

    fragment.appendChild(img);
    solarianMosaicLoadQueue.push(img);
  });

  currentSolarianMosaicRenderedCount += nextTokens.length;
  mosaicGrid.appendChild(fragment);
  pumpSolarianMosaicLoadQueue();

  requestAnimationFrame(() => {
    applySolarianMosaicLayout(mosaicGrid, currentSolarianMosaicRenderedCount);
  });
}

function handleSolarianMosaicScroll(event) {
  maybeAppendSolarianMosaicBatch(event.currentTarget);
}

function fillSolarianMosaicViewport(mosaicGrid) {
  if (!mosaicGrid) return;

  let safety = 0;
  while (
    currentSolarianMosaicRenderedCount < currentSolarianMosaicTokens.length &&
    mosaicGrid.scrollHeight <= mosaicGrid.clientHeight + 40 &&
    safety < 10
  ) {
    maybeAppendSolarianMosaicBatch(mosaicGrid, true);
    safety += 1;
  }
}

function setInventoryHeader(userName, showProfileButton, userId) {
  const title = document.getElementById('inventoryTitle');
  const profileButton = document.getElementById('inventoryProfileButton');
  const avatar = document.getElementById('inventoryAvatar');
  const tag = document.getElementById('inventoryTag');
  if (title) {
    title.textContent = userName ? `${userName}'s Inventory` : 'Inventory';
  }
  if (profileButton) profileButton.style.display = showProfileButton ? 'inline-flex' : 'none';
  hydrateUserAvatar(userId, avatar, tag);
}

const inventoryProfileButton = document.getElementById('inventoryProfileButton');
if (inventoryProfileButton) {
  inventoryProfileButton.addEventListener('click', () => {
    if (!currentProfileUserId) {
      alert('No profile selected.');
      return;
    }
    fetchUserHoldingsFor(currentProfileUserId);
    if (typeof showSection === 'function') {
      showSection('userProfileSection', { profileUserId: currentProfileUserId });
    }
  });
}

const titleOrder = [
  'commander',
  'spy',
  'pilot',
  'monitor',
  'prospector',
  'guard',
  'squad leader',
  'administrator',
  'drone',
];

function renderUserHoldings(holder) {
  const grid = document.getElementById('userHoldingsGrid');
  const viewButton = document.getElementById('viewSolariansButton');

  if (!grid) return;

  const tokens = Array.isArray(holder?.tokens) ? holder.tokens : [];
  currentUserTokens = tokens;
  queueSolarianImagePreloads(tokens);
  if (viewButton) {
    viewButton.innerHTML = buildButtonIconMarkup(
      'fa-solid fa-people-group',
      `View All ${tokens.length} Solarian${tokens.length === 1 ? '' : 's'}`
    );
    viewButton.disabled = tokens.length === 0;
  }

  grid.innerHTML = '';

  if (!tokens.length) {
    grid.innerHTML = '<div class="empty-state">No Solarians found for this profile.</div>';
    return;
  }

  const columns = [];
  let columnCount = 1;
  if (window.matchMedia('(min-width: 1200px)').matches) {
    columnCount = 3;
  } else if (window.matchMedia('(min-width: 900px)').matches) {
    columnCount = 2;
  }
  for (let i = 0; i < columnCount; i += 1) {
    const col = document.createElement('div');
    col.className = 'holdings-column';
    columns.push(col);
    grid.appendChild(col);
  }

  const normalizeTitle = (value) => safeText(value, '').toLowerCase().trim();
  const grouped = {};
  tokens.forEach((token) => {
    const attrs = Array.isArray(token?.metadata?.attributes) ? token.metadata.attributes : [];
    const titleAttr = attrs.find((attr) => normalizeTitle(attr.trait_type) === 'title');
    const titleValue = normalizeTitle(titleAttr?.value) || 'unknown';
    if (!grouped[titleValue]) grouped[titleValue] = [];
    grouped[titleValue].push(token);
  });

  const orderedTitles = [
    ...titleOrder.filter((title) => grouped[title]?.length),
    ...Object.keys(grouped).filter((title) => !titleOrder.includes(title)),
  ];

  orderedTitles.forEach((titleKey, index) => {
    const section = document.createElement('details');
    section.className = 'title-section';
    section.open = false;

    const summary = document.createElement('summary');
    summary.className = 'title-summary';
    summary.textContent = `${titleKey} (${grouped[titleKey].length})`;
    section.appendChild(summary);

    const sectionGrid = document.createElement('div');
    sectionGrid.className = 'holdings-grid';

    grouped[titleKey].forEach((token) => {
      const card = document.createElement('div');
      card.className = 'holding-card';

      const attrs = Array.isArray(token?.metadata?.attributes) ? token.metadata.attributes : [];

      const image = document.createElement('img');
      image.className = 'holding-image';
      image.alt = 'Solarian';
      if (token?.metadata?.image) {
        applySolarianImageSource(image, token.metadata.image);
      }
      if (token?.mint) {
        image.style.cursor = 'pointer';
        image.addEventListener('click', () => {
          window.open(`https://solscan.io/token/${token.mint}`, '_blank');
        });
      }

      const details = document.createElement('details');
      details.className = 'holding-details';

      const summary = document.createElement('summary');
      summary.className = 'holding-summary';
      summary.textContent = 'Details';
      details.appendChild(summary);

      const metaWrap = document.createElement('div');
      metaWrap.className = 'holding-meta';

      const subtitle = document.createElement('div');
      subtitle.className = 'holding-subtitle';
      const mintNumber = attrs.find(
        (attr) => safeText(attr.trait_type, '').toLowerCase() === 'mint #'
      );
      subtitle.textContent = mintNumber
        ? `Mint #${safeText(mintNumber.value, 'N/A')}`
        : 'Mint #N/A';

      metaWrap.appendChild(subtitle);
      // Mint hash is accessible via the image link to Solscan.

      const attrsWrap = document.createElement('div');
      attrsWrap.className = 'holding-attrs';
      attrs
        .filter((attr) => {
          const trait = safeText(attr.trait_type, '').toLowerCase();
          return trait !== 'title' && trait !== 'mint #';
        })
        .forEach((attr) => {
      const pill = document.createElement('div');
      pill.className = 'holding-attr';
      const label = attr.trait_type ? `${attr.trait_type}: ` : '';
      pill.textContent = `${label}${safeText(attr.value, 'N/A')}`;
      attrsWrap.appendChild(pill);
    });

      details.appendChild(metaWrap);
      if (attrsWrap.childElementCount) {
        details.appendChild(attrsWrap);
      }

      card.appendChild(image);
      card.appendChild(details);

      sectionGrid.appendChild(card);
    });

    section.appendChild(sectionGrid);
    const targetColumn = columns[index % columns.length];
    targetColumn.appendChild(section);
  });
}

function renderSolarianMosaic(tokens) {
  const mosaicGrid = document.getElementById('solarianMosaicGrid');
  if (!mosaicGrid) return;

  if (solarianMosaicImageObserver) {
    solarianMosaicImageObserver.disconnect();
    solarianMosaicImageObserver = null;
  }

  mosaicGrid.innerHTML = '';
  mosaicGrid.classList.remove(
    'mosaic-count-1',
    'mosaic-count-2',
    'mosaic-count-3',
    'mosaic-count-10',
    'mosaic-count-20'
  );
  mosaicGrid.style.removeProperty('grid-template-columns');
  mosaicGrid.style.removeProperty('grid-template-rows');
  mosaicGrid.style.removeProperty('grid-auto-rows');
  mosaicGrid.removeEventListener('scroll', handleSolarianMosaicScroll);
  mosaicGrid.scrollTop = 0;

  const count = Array.isArray(tokens) ? tokens.length : 0;
  currentSolarianMosaicTokens = Array.isArray(tokens)
    ? tokens.filter((token) => token?.metadata?.image)
    : [];
  currentSolarianMosaicRenderedCount = 0;
  solarianMosaicLoadQueue.length = 0;
  solarianMosaicActiveLoadCount = 0;
  if (count <= 1) {
    mosaicGrid.classList.add('mosaic-count-1');
  } else if (count <= 2) {
    mosaicGrid.classList.add('mosaic-count-2');
  } else if (count <= 3) {
    mosaicGrid.classList.add('mosaic-count-3');
  } else if (count <= 10) {
    mosaicGrid.classList.add('mosaic-count-10');
  } else if (count <= 20) {
    mosaicGrid.classList.add('mosaic-count-20');
  }

  maybeAppendSolarianMosaicBatch(mosaicGrid, true);
  requestAnimationFrame(() => {
    fillSolarianMosaicViewport(mosaicGrid);
    requestAnimationFrame(() => {
      fillSolarianMosaicViewport(mosaicGrid);
    });
  });
  if (currentSolarianMosaicTokens.length > currentSolarianMosaicRenderedCount) {
    mosaicGrid.addEventListener('scroll', handleSolarianMosaicScroll);
  }
}

function applySolarianMosaicLayout(mosaicGrid, count) {
  if (!mosaicGrid || count <= 0) return;

  const gridWidth = mosaicGrid.clientWidth;
  const gridHeight = mosaicGrid.clientHeight;
  if (!gridWidth || !gridHeight) return;

  // For moderate counts, compute a near-square grid to maximize coverage.
  if (count <= 60) {
    let columns;
    let rows;

    if (count === 1) {
      columns = 1;
      rows = 1;
    } else if (count <= 3) {
      columns = 2;
      rows = 2;
    } else {
      const aspect = gridWidth / gridHeight;
      columns = Math.max(2, Math.ceil(Math.sqrt(count * aspect)));
      rows = Math.ceil(count / columns);
      if (rows === 1) {
        rows = 2;
        columns = Math.ceil(count / rows);
      }
    }

    mosaicGrid.style.gridTemplateColumns = `repeat(${columns}, minmax(0, 1fr))`;
    mosaicGrid.style.gridTemplateRows = `repeat(${rows}, minmax(0, 1fr))`;
    mosaicGrid.style.gridAutoRows = '1fr';
    return;
  }

  // For large counts, fall back to fixed sizing + scroll (CSS defaults).
  mosaicGrid.style.removeProperty('grid-template-columns');
  mosaicGrid.style.removeProperty('grid-template-rows');
  mosaicGrid.style.removeProperty('grid-auto-rows');
}

async function loadUserHoldingsFromUrl(fetchUrl, fallbackUserId = null, routePath = null) {
  const grid = document.getElementById('userHoldingsGrid');
  const profileTitle = document.getElementById('userProfileTitle');
  const profileAvatar = document.getElementById('userProfileAvatar');
  const profileTag = document.getElementById('userProfileTag');
  if (!grid) return;

  currentProfileUserId = fallbackUserId || null;
  currentProfileUsername = null;
  currentProfileRoutePath = routePath || (fallbackUserId ? encodeURIComponent(fallbackUserId) : null);
  renderUserProfileDetails(null);
  syncEditProfileButtonVisibility();

  grid.innerHTML = '<div class="empty-state">Loading holdings...</div>';

  if (!fetchUrl) {
    grid.innerHTML = '<div class="empty-state">No profile identifier found.</div>';
    if (profileTitle) profileTitle.textContent = '👤 User Profile';
    hydrateUserAvatar(null, profileAvatar, profileTag);
    syncEditProfileButtonVisibility();
    return;
  }

  try {
    const response = await fetch(fetchUrl, {
      headers: getAuthHeaders(),
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch holder data: ${response.statusText}`);
    }

    const holder = await response.json();
    if (!holder) {
      grid.innerHTML = '<div class="empty-state">No verified holder profile found.</div>';
      if (profileTitle) profileTitle.textContent = 'User Profile';
      hydrateUserAvatar(fallbackUserId, profileAvatar, profileTag);
      renderUserProfileDetails(null);
      syncEditProfileButtonVisibility();
      return;
    }

    const resolvedUserId = holder.discordId ? String(holder.discordId) : fallbackUserId;
    let username = holder.username || holder.twitterHandle || holder.walletAddress || resolvedUserId;
    if (resolvedUserId) {
      if (resolvedUserId === localStorage.getItem('discordUserID')) {
        username = localStorage.getItem('username') || username;
      } else if (!holder.username) {
        username = await resolveUsername(resolvedUserId);
      }
    }

    currentProfileUserId = resolvedUserId || null;
    currentProfileUsername = username || resolvedUserId || null;
    currentProfileRoutePath = routePath || buildUsernameRoutePath(holder.username, resolvedUserId);

    if (profileTitle) {
      const nameLabel = username || resolvedUserId || 'User';
      profileTitle.textContent = `${nameLabel}'s Profile`;
    }
    hydrateUserAvatar(resolvedUserId, profileAvatar, profileTag);
    renderUserProfileDetails(holder);
    syncEditProfileButtonVisibility();

    renderUserHoldings(holder);
  } catch (error) {
    console.error('Error loading holdings:', error);
    grid.innerHTML = '<div class="empty-state">Could not load holdings data.</div>';
    if (profileTitle) profileTitle.textContent = 'User Profile';
    hydrateUserAvatar(fallbackUserId, profileAvatar, profileTag);
    renderUserProfileDetails(null);
    syncEditProfileButtonVisibility();
  }
}

async function fetchUserHoldingsFor(userId) {
  if (!userId) {
    return loadUserHoldingsFromUrl(null, null, null);
  }
  return loadUserHoldingsFromUrl(
    `/api/holder/${encodeURIComponent(userId)}`,
    String(userId),
    encodeURIComponent(userId)
  );
}

async function fetchUserHoldingsByWallet(walletAddress) {
  const normalizedWallet = String(walletAddress || '').trim();
  if (!normalizedWallet) {
    return loadUserHoldingsFromUrl(null, null, null);
  }
  return loadUserHoldingsFromUrl(
    `/api/holder/wallet/${encodeURIComponent(normalizedWallet)}`,
    null,
    `wallet/${encodeURIComponent(normalizedWallet)}`
  );
}

async function fetchUserHoldingsByTwitter(twitterHandle) {
  const normalizedHandle = String(twitterHandle || '').trim().replace(/^@+/, '');
  if (!normalizedHandle) {
    return loadUserHoldingsFromUrl(null, null, null);
  }
  return loadUserHoldingsFromUrl(
    `/api/holder/twitter/${encodeURIComponent(normalizedHandle)}`,
    null,
    `twitter/${encodeURIComponent(normalizedHandle)}`
  );
}

async function fetchUserHoldingsByUsername(username) {
  const normalizedUsername = String(username || '').trim();
  if (!normalizedUsername) {
    return loadUserHoldingsFromUrl(null, null, null);
  }
  return loadUserHoldingsFromUrl(
    `/api/holder/username/${encodeURIComponent(normalizedUsername)}`,
    null,
    `username/${encodeURIComponent(normalizedUsername)}`
  );
}

async function fetchUserHoldingsByProfileRoute(routePath) {
  const cleanRoutePath = String(routePath || '').trim();
  if (!cleanRoutePath) {
    return fetchUserHoldings();
  }

  if (!cleanRoutePath.includes('/')) {
    if (/^\d{15,25}$/.test(cleanRoutePath)) {
      return fetchUserHoldingsFor(decodeURIComponent(cleanRoutePath));
    }
    return fetchUserHoldingsByUsername(decodeURIComponent(cleanRoutePath));
  }

  const [routeType, ...routeTail] = cleanRoutePath.split('/');
  const routeValue = decodeURIComponent(routeTail.join('/'));

  if (routeType === 'wallet' && routeValue) {
    return fetchUserHoldingsByWallet(routeValue);
  }
  if (routeType === 'twitter' && routeValue) {
    return fetchUserHoldingsByTwitter(routeValue);
  }
  if (routeType === 'username' && routeValue) {
    return fetchUserHoldingsByUsername(routeValue);
  }
  return fetchUserHoldingsFor(decodeURIComponent(cleanRoutePath));
}

async function fetchUserHoldings() {
  const discordUserId = localStorage.getItem('discordUserID');
  const username = localStorage.getItem('username');
  if (username) {
    return fetchUserHoldingsByUsername(username);
  }
  return fetchUserHoldingsFor(discordUserId);
}

const viewProfileInventoryButton = document.getElementById('viewProfileInventoryButton');
if (viewProfileInventoryButton) {
  viewProfileInventoryButton.addEventListener('click', () => {
    const localUserId = localStorage.getItem('discordUserID');
    const targetUserId = currentProfileUserId || localUserId;

    if (!targetUserId) {
      alert('No profile selected.');
      return;
    }

    if (targetUserId === localUserId) {
      if (typeof fetchInventory === 'function') {
        fetchInventory();
      }
      if (typeof showSection === 'function') {
        showSection('inventorySection');
      }
    } else {
      fetchUserInventory(targetUserId);
    }
  });
}

const editUserProfileButton = document.getElementById('editUserProfileButton');
if (editUserProfileButton) {
  editUserProfileButton.addEventListener('click', openEditProfileModal);
}















//========================
// Raffles
//========================
(function () {
  const showRafflesButton = document.getElementById("showRafflesButton");
  const rafflesSection = document.getElementById("rafflesSection");
  const rafflesList = document.getElementById("rafflesList");
  const rafflesBackButton = rafflesSection?.querySelector(".back-button");

  // Prevent multiple API calls
  let isRaffleListLoading = false;

  // Ensure only one event listener exists
  if (showRafflesButton) {
    showRafflesButton.removeEventListener("click", handleShowRaffles);
    showRafflesButton.addEventListener("click", handleShowRaffles);
  }

  async function handleShowRaffles() {
    showSection("rafflesSection");
    await populateRaffleList();
  }

  if (rafflesBackButton) {
    rafflesBackButton.addEventListener("click", () => {
      showSection("landingPage");
    });
  }

  async function populateRaffleList() {
    if (isRaffleListLoading) return;
    isRaffleListLoading = true;

    rafflesList.innerHTML = ""; // Clears old items before rendering

    try {
      const [shopResponse, activeResponse] = await Promise.all([
        fetch("/api/shop"),
        fetch("/api/raffles/active"),
      ]);
      const data = await shopResponse.json();
      const activeRaffles = await activeResponse.json();
      const activeNames = new Set(
        (Array.isArray(activeRaffles) ? activeRaffles : [])
          .map((raffle) => String(raffle?.name || "").trim().toLowerCase())
          .filter(Boolean)
      );

      // Group by name and sum quantities
      const raffleMap = new Map();
      data.forEach((item) => {
        if (item.name.toLowerCase().includes("raffle ticket")) {
          const normalizedName = item.name.trim().toLowerCase(); // Normalize names
          const baseName = normalizedName.replace(/\s*raffle ticket\s*$/i, "").trim();
          if (!activeNames.has(baseName)) {
            return;
          }

          if (raffleMap.has(normalizedName)) {
            raffleMap.get(normalizedName).quantity += item.quantity; // Merge quantities
          } else {
            raffleMap.set(normalizedName, { ...item, originalName: item.name }); // Store with original name
          }
        }
      });

      const groupedRaffles = Array.from(raffleMap.values());

      if (groupedRaffles.length === 0) {
        rafflesList.innerHTML =
          "<p style='text-align: center;'>No raffle tickets available at the moment.</p>";
        return;
      }

      // Render unique grouped items
      groupedRaffles.forEach((item) => {
        const itemWrapper = document.createElement("div");
        itemWrapper.className = "raffle-item-wrapper";

        const itemContainer = document.createElement("div");
        itemContainer.className = "raffle-item";
        itemContainer.style.cursor = "pointer";

        const detailsSpan = document.createElement("span");
        detailsSpan.innerHTML = `<strong>${item.originalName}</strong> - ⚡${item.price} | QTY: ${item.quantity}`;
        itemContainer.appendChild(detailsSpan);

        const descriptionSpan = document.createElement("span");
        descriptionSpan.innerHTML = item.description.replace(
          /\[([^\]]+)\]\(([^)]+)\)/g,
          '<a href="$2" target="_blank" class="link">$1</a>'
        );
        itemContainer.appendChild(descriptionSpan);

        // Attach purchase confirmation on click
        itemContainer.addEventListener("click", () => showRaffleConfirmation(item));

        itemWrapper.appendChild(itemContainer);
        rafflesList.appendChild(itemWrapper);
      });
    } catch (error) {
      console.error("Error fetching raffle tickets:", error);
      rafflesList.innerHTML =
        "<p style='text-align: center;'>Failed to load raffle tickets. Please try again later.</p>";
    } finally {
      isRaffleListLoading = false;
    }
  }

  /**
 * Show a confirmation modal before purchasing raffle tickets with quantity input.
 * @param {Object} item - Raffle item details.
 */
  function showRaffleConfirmation(item) {
    const modalOverlay = document.createElement("div");
    modalOverlay.className = "modal-overlay";
  
    const modalBox = document.createElement("div");
    modalBox.className = "modal-box";
    modalBox.innerHTML = `
      <h2>CONFIRM PURCHASE</h2>
      <p>How many <strong>${item.originalName}</strong> would you like to buy?</p>
      <p>Price per ticket: ⚡${item.price}</p>
      <input type="number" id="raffleQuantity" min="1" value="1" style="margin: 10px 0; width: 100%; padding: 6px;" />
      <p id="totalCost">Total: ⚡${item.price}</p>
      <div class="modal-buttons">
        <button class="confirm-button" id="confirmRafflePurchase">CONFIRM</button>
        <button class="cancel-button" id="cancelRafflePurchase">CANCEL</button>
      </div>
    `;
  
    modalOverlay.appendChild(modalBox);
    document.body.appendChild(modalOverlay);
  
    const quantityInput = document.getElementById("raffleQuantity");
    const totalCostDisplay = document.getElementById("totalCost");
  
    quantityInput.addEventListener("input", () => {
      const quantity = parseInt(quantityInput.value, 10) || 1;
      totalCostDisplay.textContent = `Total: ⚡${item.price * quantity}`;
    });
  
    document.getElementById("confirmRafflePurchase").addEventListener("click", () => {
      const quantity = parseInt(quantityInput.value, 10);
      if (isNaN(quantity) || quantity < 1) {
        alert("Please enter a valid quantity.");
        return;
      }
      modalOverlay.remove();
      buyRaffleTicket(item.originalName, quantity, item.price);
    });
  
    document.getElementById("cancelRafflePurchase").addEventListener("click", () => {
      modalOverlay.remove();
    });
  }
  
  /**
   * Send purchase request for the raffle tickets.
   * @param {string} itemName - Name of the raffle ticket.
   * @param {number} quantity - Number of tickets to buy.
   * @param {number} price - Price per ticket (for display only).
   */
  async function buyRaffleTicket(itemName, quantity, price) {
    const token = localStorage.getItem("token");
    if (!token) {
      alert("You must be logged in to buy raffle tickets.");
      return;
    }
  
    try {
      const response = await fetch("/api/buy", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ itemName, quantity }),
      });
  
      const result = await response.json();
      if (response.ok) {
        const bonusTickets = Number(result?.bonusTickets || 0);
        const bonusMilestones = Array.isArray(result?.bonusMilestones) ? result.bonusMilestones : [];

        const purchaseMessage = `✅ You bought ${quantity} "${itemName}" ticket(s) for ⚡${price * quantity}.`;

        if (bonusTickets > 0 && bonusMilestones.length) {
          const milestoneText = bonusMilestones
            .map((m) => `${m.threshold}th (+${m.bonus})`)
            .join(", ");
          const bonusMessage =
            `🎟️ You hit ${milestoneText} for "${itemName}" and received ` +
            `${bonusTickets} free ticket(s).`;

          showConfirmationPopup(purchaseMessage, () => {
            showConfirmationPopup(bonusMessage);
          });
        } else {
          showConfirmationPopup(purchaseMessage);
        }

        fetchVoltBalance();
      } else {
        showConfirmationPopup(`❌ Purchase failed: ${result.error}`);
      }
    } catch (error) {
      console.error("Error processing raffle purchase:", error);
      showConfirmationPopup("❌ An error occurred while processing your purchase.");
    }
  }
  

/**
 * Show a confirmation message popup after purchase.
 * @param {string} message - The message to display.
 */
function showConfirmationPopup(message, onClose) {
  const modalOverlay = document.createElement("div");
  modalOverlay.className = "modal-overlay";

  const modalBox = document.createElement("div");
  modalBox.className = "modal-box";
  modalBox.innerHTML = `
    <p>${message}</p>
    <button class="confirm-button" id="closeModal">OK</button>
  `;

  modalOverlay.appendChild(modalBox);
  document.body.appendChild(modalOverlay);

  document.getElementById("closeModal").addEventListener("click", () => {
    modalOverlay.remove();
    if (typeof onClose === "function") onClose();
  });
}

})();









// Daily Tasks Countdown Timer (Resets at Midnight EST/EDT)
// ---------------------------------------------------------

/**
 * Returns the absolute UTC timestamp (in milliseconds) for the upcoming midnight 
 * in New York (America/New_York) based on New York’s wall‐clock day.
 *
 * This function first “converts” the current time to New York time by using 
 * toLocaleString() with the appropriate timeZone. It then creates a Date object 
 * from that string (which is parsed as a local Date) and resets it to midnight. 
 * Because the conversion loses the actual New York offset, we compute the difference 
 * between the current absolute time and the parsed “New York time” and adjust accordingly.
 */
function getNextMidnightNY() {
  const now = new Date();
  // Convert current time to a string in New York’s timezone.
  // (The format “en-US” works reliably in most browsers.)
  const nowInNYString = now.toLocaleString("en-US", { timeZone: "America/New_York" });
  // Parse that string to get a Date object.
  // (This Date is created in the browser’s local timezone but its time reflects NY’s wall clock.)
  const nowNY = new Date(nowInNYString);
  
  // Create a Date for New York’s midnight today (using the NY wall-clock date)
  const nyMidnightToday = new Date(nowNY);
  nyMidnightToday.setHours(0, 0, 0, 0);
  
  // The upcoming NY midnight is the midnight of the next day.
  nyMidnightToday.setDate(nyMidnightToday.getDate() + 1);
  
  // Because nowNY was parsed in local time, we compute the offset difference between 
  // the true current time (now) and the parsed New York time (nowNY).
  const offsetDiff = now.getTime() - nowNY.getTime();
  
  // Adjust the NY midnight by that difference to get the correct absolute timestamp.
  return nyMidnightToday.getTime() + offsetDiff;
}

/**
 * Updates the countdown timer displayed on the page.
 * The timer shows the remaining time (HH:MM:SS) until midnight in New York.
 */
function updateCountdown() {
  const countdownElem = document.getElementById("countdownTimer");
  if (!countdownElem) return;

  const now = Date.now();
  const nextMidnightUTC = getNextMidnightNY();
  const diff = nextMidnightUTC - now;

  // When the countdown reaches (or passes) zero, force a refresh so the UI can reset.
  if (diff <= 0) {
    location.reload();
    return;
  }

  // Convert the difference into hours, minutes, and seconds.
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((diff % (1000 * 60)) / 1000);

  countdownElem.innerText = `${hours.toString().padStart(2, '0')}:` +
                              `${minutes.toString().padStart(2, '0')}:` +
                              `${seconds.toString().padStart(2, '0')}`;
}

const dailyQuestDefinitions = [
  {
    key: 'firstMessage',
    label: '🎁 User\'s first message of the day receives a bonus of 8 Volts.',
    goal: 1,
  },
  {
    key: 'roboChatMessages',
    label: '💬 Send up to 16 messages in <a href="https://discord.com/channels/1014872741846974514/1015078531526574141" target="_blank" rel="noopener noreferrer">#robo-chat</a> to get charged up 1 Volt per message.',
    goal: 16,
  },
  {
    key: 'announcementReaction',
    label: '🤖 React to a new message in <a href="https://discord.com/channels/1014872741846974514/1015076041934520330" target="_blank" rel="noopener noreferrer">#announcements</a> once per day to receive 8 Volts.',
    goal: 1,
  },
  {
    key: 'rpsWins',
    label: '🪨 Use <code>/rps</code> to play rock paper scissors. First 3 wins of the day get a bonus 8 Volts.',
    goal: 3,
  },
];

const otherAutoQuestDefinitions = [
  {
    key: 'weeklyDaoCallLastReceivedAt',
    label: '🎙️ Join the weekly DAO call for at least 15 minutes to earn 40 Volts.',
    type: 'last-received',
  },
  {
    key: 'raffleBonus10Received',
    label: '🎟️ Buy 10 Raffle tickets get 1 free.',
    type: 'checkbox',
  },
  {
    key: 'raffleBonus25Received',
    label: '🎟️ Buy 25 Raffle tickets get 2 free.',
    type: 'checkbox',
  },
  {
    key: 'raffleBonus50Received',
    label: '🎟️ Buy 50 Raffle tickets get 3 free.',
    type: 'checkbox',
  },
];

function renderDailyQuestProgress(progress = {}) {
  const dailyTasksList = document.getElementById('dailyTasksList');
  if (!dailyTasksList) return;

  dailyTasksList.innerHTML = dailyQuestDefinitions.map((quest) => {
    const current = Math.max(0, Number(progress?.[quest.key]?.current || 0));
    const goal = Math.max(1, Number(progress?.[quest.key]?.goal || quest.goal));
    const completed = current >= goal;
    const statusLabel = goal === 1
      ? (completed ? '1 / 1' : '0 / 1')
      : `${Math.min(current, goal)} / ${goal}`;

    return `
      <li class="daily-quest-progress-row ${completed ? 'is-complete' : ''}">
        <label class="daily-quest-progress-main">
          <input type="checkbox" class="daily-quest-progress-check" ${completed ? 'checked' : ''} disabled />
          <span class="daily-quest-progress-text">${quest.label}</span>
        </label>
        <span class="daily-quest-progress-count">${statusLabel}</span>
      </li>
    `;
  }).join('');
}

function formatQuestRewardDate(timestampSeconds) {
  const timestamp = Number(timestampSeconds || 0);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return 'Never';

  return new Date(timestamp * 1000).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function renderOtherAutoQuestProgress(otherProgress = {}) {
  const autoTasksList = document.getElementById('autoTasksList');
  if (!autoTasksList) return;

  autoTasksList.innerHTML = otherAutoQuestDefinitions.map((quest) => {
    if (quest.type === 'last-received') {
      const lastReceived = formatQuestRewardDate(otherProgress?.[quest.key]);
      return `
        <li class="daily-quest-progress-row">
          <div class="daily-quest-progress-main">
            <span class="daily-quest-progress-text">${quest.label}</span>
          </div>
          <span class="other-quest-last-received">Last received: ${lastReceived}</span>
        </li>
      `;
    }

    const completed = Boolean(otherProgress?.[quest.key]);
    return `
      <li class="daily-quest-progress-row ${completed ? 'is-complete' : ''}">
        <label class="daily-quest-progress-main">
          <input type="checkbox" class="daily-quest-progress-check" ${completed ? 'checked' : ''} disabled />
          <span class="daily-quest-progress-text">${quest.label}</span>
        </label>
      </li>
    `;
  }).join('');
}

async function loadDailyQuestProgress() {
  renderDailyQuestProgress({});
  renderOtherAutoQuestProgress({});

  const token = localStorage.getItem('token');
  if (!token) return;

  try {
    const response = await fetch('/api/auto-quests/progress', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    const progress = await response.json();
    if (!response.ok) {
      throw new Error(progress.message || 'Failed to load quest progress.');
    }
    renderDailyQuestProgress(progress);
    renderOtherAutoQuestProgress(progress?.otherAutoQuests || {});
  } catch (error) {
    console.error('Error loading auto quest progress:', error);
  }
}

// Starts (or restarts) the countdown timer.
let countdownInterval;
function startCountdownTimer() {
  updateCountdown();
  loadDailyQuestProgress();
  if (countdownInterval) clearInterval(countdownInterval);
  countdownInterval = setInterval(updateCountdown, 1000);
}

// Start the countdown when the page loads.
document.addEventListener("DOMContentLoaded", startCountdownTimer);

// Optional: If your UI uses a button to show daily tasks.
const showDailyTasksButton = document.getElementById('showDailyTasksButton');
if (showDailyTasksButton) {
  showDailyTasksButton.addEventListener('click', () => {
    showSection('dailyTasksPage'); // Assumes you have a function to display the desired section.
    startCountdownTimer();
  });
}


// ------------------------------
// Console Section with Rolling Updates & Mobile Log Limit
// ------------------------------
const showConsoleButton = document.getElementById("showConsoleButton");
let consoleUpdateInterval = null; // Store interval reference

if (showConsoleButton) {
  showConsoleButton.addEventListener("click", () => {
    showSection("consoleSection");
    fetchAndDisplayConsoleLogs(); // Fetch logs immediately
    startConsoleUpdates(); // Start rolling updates every 5 seconds
  });
}

// Fetch and display logs
async function fetchAndDisplayConsoleLogs() {
  try {
    const response = await fetch("/api/console");
    if (!response.ok) {
      throw new Error("Failed to fetch console logs");
    }
    let logs = await response.json();
    console.log("Fetched logs:", logs); // Debugging log

    // Ensure logs is an array; if not, try extracting from an object
    if (!Array.isArray(logs)) {
      logs = logs.logs || Object.values(logs);
    }

    // Limit logs to the last 8 items on mobile devices
    if (isMobileDevice() && logs.length > 8) {
      logs = logs.slice(-8);
    }

    const consoleLogs = document.getElementById("consoleLogs");
    if (!consoleLogs) return;

    // Clear previous logs
    consoleLogs.innerHTML = "";

    if (logs.length === 0) {
      consoleLogs.innerHTML = `<li class="log-item">No logs available.</li>`;
    } else {
      logs.forEach(log => {
        const rawTimestamp = log.timestamp || log.time || 'Unknown Time';
        const message = log.message || log.msg || 'Unknown Message';

        // Convert timestamp to local time (hh:mm:ss AM/PM)
        let formattedTime = "Unknown Time";
        if (rawTimestamp !== "Unknown Time") {
          const date = new Date(rawTimestamp);
          formattedTime = date.toLocaleTimeString(undefined, {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: true,
          });
        }

        const li = document.createElement("li");
        li.className = "log-item";
        li.innerHTML = `<strong>[${formattedTime}]</strong> ${message}`;
        consoleLogs.appendChild(li);
      });
    }

    // Force the scrollbar to scroll to the bottom
    consoleLogs.scrollTop = consoleLogs.scrollHeight;
    
  } catch (error) {
    console.error("Error fetching console logs:", error);
    const consoleLogs = document.getElementById("consoleLogs");
    if (consoleLogs) {
      consoleLogs.innerHTML =
        `<li class="log-item error">⚠️ Error loading logs. Please try again later.</li>`;
    }
  }
}

// Start rolling updates every 5 seconds
function startConsoleUpdates() {
  if (consoleUpdateInterval) clearInterval(consoleUpdateInterval);
  consoleUpdateInterval = setInterval(fetchAndDisplayConsoleLogs, 5000);
}

// Stop updates when leaving the console section
function stopConsoleUpdates() {
  if (consoleUpdateInterval) {
    clearInterval(consoleUpdateInterval);
    consoleUpdateInterval = null;
  }
}

// Detect when user leaves the console section (assumes elements with class "back-button" exist)
document.querySelectorAll(".back-button").forEach(button => {
  button.addEventListener("click", stopConsoleUpdates);
});

// Helper function to detect if the user is on a mobile device
function isMobileDevice() {
  return /Mobi|Android|iPhone|iPad|iPod/.test(navigator.userAgent);
}


// ===========================
// Robot Oil Market Section
// ===========================

const showRobotOilButton = document.getElementById("showRobotOilButton");
const marketBuyButton = document.getElementById("marketBuyButton");
const marketSellButton = document.getElementById("marketSellButton");
const offerSaleButton = document.getElementById("offerSaleButton");
const offerPurchaseButton = document.getElementById("offerBuyButton");

if (showRobotOilButton) showRobotOilButton.addEventListener("click", showRobotOilMarket);
if (marketBuyButton) marketBuyButton.addEventListener("click", prepareMarketBuy);
if (marketSellButton) marketSellButton.addEventListener("click", prepareMarketSell);
if (offerSaleButton) offerSaleButton.addEventListener("click", () => showOfferModal('sale'));
if (offerPurchaseButton) offerPurchaseButton.addEventListener("click", () => showOfferModal('purchase'));

function customConfirm(message, onConfirm) {
  const modalOverlay = document.createElement("div");
  modalOverlay.className = "modal-overlay";

  const modalBox = document.createElement("div");
  modalBox.className = "modal-box";
  modalBox.innerHTML = `
    <h2>Confirm</h2>
    <p>${message}</p>
    <div style="margin-top: 10px;">
      <button class="confirm-button">Yes</button>
      <button class="cancel-button">No</button>
    </div>
  `;

  modalOverlay.appendChild(modalBox);
  document.body.appendChild(modalOverlay);

  const yesButton = modalBox.querySelector(".confirm-button");
  const noButton = modalBox.querySelector(".cancel-button");

  yesButton.addEventListener("click", () => {
    onConfirm();
    modalOverlay.remove();
  });

  noButton.addEventListener("click", () => {
    modalOverlay.remove();
  });
}

async function handleMarketBuy(endpoint) {
  const token = localStorage.getItem("token");
  if (!token) return alert('You must be logged in!');

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ quantity: 1 }),
    });

    const result = await response.json();
    if (response.ok) {
      showConfirmationPopup(result.message || '✅ Market action successful!');
      fetchVoltBalance();
      await loadOrderBook();
    } else {
      showConfirmationPopup(`❌ Market action failed: ${result.error}`);
    }
  } catch (error) {
    console.error('Error processing market order:', error);
    showConfirmationPopup('❌ Failed to process market order.');
  }
}

async function prepareMarketBuy() {
  try {
    const response = await fetch('/api/oil-market');
    const listings = await response.json();
    const loggedInUserId = localStorage.getItem('discordUserID');

    const sellOrders = listings.filter(l => l.type === 'sale');
    if (sellOrders.length === 0) return showConfirmationPopup('❌ No sell listings available.');

    sellOrders.sort((a, b) => a.price_per_unit - b.price_per_unit);
    const cheapest = sellOrders[0];

    if (loggedInUserId && cheapest.seller_id === loggedInUserId) {
      return showConfirmationPopup('🚫 You cannot buy your own listing!');
    }

    customConfirm(`Buy 1 barrel for ⚡${cheapest.price_per_unit}?`, async () => {
      await handleMarketBuy('/api/oil/market-buy');
    });
  } catch (error) {
    console.error('Error fetching market data:', error);
    showConfirmationPopup('❌ Failed to fetch listings.');
  }
}

async function prepareMarketSell() {
  try {
    const response = await fetch('/api/oil-market');
    const listings = await response.json();
    const loggedInUserId = localStorage.getItem('discordUserID');

    const buyOrders = listings.filter(l => l.type === 'purchase');
    if (buyOrders.length === 0) return showConfirmationPopup('❌ No buy listings available.');

    buyOrders.sort((a, b) => b.price_per_unit - a.price_per_unit);
    const highestBid = buyOrders[0];

    if (loggedInUserId && highestBid.seller_id === loggedInUserId) {
      return showConfirmationPopup('🚫 You cannot sell to your own bid!');
    }

    customConfirm(`Sell 1 barrel for ⚡${highestBid.price_per_unit}?`, async () => {
      await handleMarketBuy('/api/oil/market-sell');
    });
  } catch (error) {
    console.error('Error fetching market data:', error);
    showConfirmationPopup('❌ Failed to fetch listings.');
  }
}

async function showRobotOilMarket() {
  const oilChartCanvas = document.getElementById('oilChart');
  if (!oilChartCanvas) return console.error("No oilChart element found!");

  try {
    const response = await fetch('/api/oil-history');
    const history = await response.json();

    const labels = history.map(entry => entry.date);
    const prices = history.map(entry => entry.price);
    const ctx = oilChartCanvas.getContext('2d');
    const isUp = prices.length > 1 ? prices[prices.length - 1] >= prices[0] : true;
    const lineColor = isUp ? '#22c55e' : '#ef4444';
    const gradient = ctx.createLinearGradient(0, 0, 0, 300);
    gradient.addColorStop(0, isUp ? 'rgba(34, 197, 94, 0.35)' : 'rgba(239, 68, 68, 0.35)');
    gradient.addColorStop(1, 'rgba(30, 41, 59, 0.0)');

    if (window.oilChartInstance) window.oilChartInstance.destroy();

    window.oilChartInstance = new Chart(oilChartCanvas, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Robot Oil Price',
          data: prices,
          borderColor: lineColor,
          backgroundColor: gradient,
          borderWidth: 2.5,
          pointRadius: 0,
          pointHoverRadius: 5,
          pointHitRadius: 12,
          tension: 0.35,
          fill: true
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#0f172a',
            titleColor: '#e2e8f0',
            bodyColor: '#e2e8f0',
            displayColors: false,
            callbacks: {
              label: (context) => `⚡ ${context.parsed.y} / barrel`,
            },
          }
        },
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: '#94a3b8', maxTicksLimit: 6 }
          },
          y: {
            beginAtZero: false,
            grid: { color: 'rgba(148, 163, 184, 0.15)' },
            ticks: {
              color: '#94a3b8',
              callback: (value) => `⚡ ${value}`,
            }
          }
        }
      }
    });

    await loadOrderBook();
    showSection('robotOilSection');
  } catch (error) {
    console.error('Error loading oil history:', error);
  }
}

async function loadOrderBook() {
  try {
    const response = await fetch('/api/oil-market');
    const listings = await response.json();
    const loggedInUserId = localStorage.getItem('discordUserID');

    const sellOrders = listings.filter(l => l.type === 'sale').sort((a, b) => a.price_per_unit - b.price_per_unit);
    const buyOrders = listings.filter(l => l.type === 'purchase').sort((a, b) => b.price_per_unit - a.price_per_unit);

    const sellContainer = document.getElementById('sellOrders');
    const buyContainer = document.getElementById('buyOrders');
    sellContainer.innerHTML = '';
    buyContainer.innerHTML = '';

    const renderOrder = (listing, container) => {
      const div = document.createElement('div');
      div.className = 'listing-row';
      div.style.cssText = 'margin-bottom: 10px; padding: 8px; background: #3b4c5a; border-radius: 6px; display: flex; justify-content: space-between; align-items: center;';
      const sellerLabel = listing.seller_tag || listing.seller_id;
      div.innerHTML = `
        <span>🧑 <a href="https://discord.com/users/${listing.seller_id}" target="_blank" class="link">@${sellerLabel}</a></span>
        <span>🛢️ Qty: ${listing.quantity}</span>
        <span>⚡ ${listing.price_per_unit} / barrel</span>
      `;

      if (loggedInUserId && listing.seller_id === loggedInUserId) {
        const cancelButton = document.createElement('button');
        cancelButton.textContent = '❌';
        cancelButton.className = 'cancel-button';
        cancelButton.addEventListener('click', () => {
          customConfirm('Cancel this listing?', () => cancelOilListing(listing.listing_id, listing.type));
        });
        div.appendChild(cancelButton);
      }

      container.appendChild(div);
    };

    sellOrders.forEach(l => renderOrder(l, sellContainer));
    buyOrders.forEach(l => renderOrder(l, buyContainer));
  } catch (error) {
    console.error('Failed to load order book:', error);
  }
}

async function cancelOilListing(listingId, type) {
  const token = localStorage.getItem('token');
  if (!token) return alert('You must be logged in!');

  try {
    const response = await fetch('/api/oil/cancel', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ listing_id: listingId, type }),
    });

    const result = await response.json();
    if (response.ok) {
      showConfirmationPopup(`✅ ${result.message}`);
      await loadOrderBook();
    } else {
      showConfirmationPopup(`❌ Cancel failed: ${result.error}`);
    }
  } catch (error) {
    console.error('Error canceling listing:', error);
    showConfirmationPopup('❌ Failed to cancel listing.');
  }
}

function showOfferModal(type) {
  const modalOverlay = document.createElement("div");
  modalOverlay.className = "modal-overlay";

  const modalBox = document.createElement("div");
  modalBox.className = "modal-box";
  modalBox.innerHTML = `
    <h2>${type === 'sale' ? 'OFFER SALE' : 'OFFER PURCHASE'}</h2>
    <p>Enter quantity and price per barrel:</p>
    <input type="number" id="modalQuantity" placeholder="Quantity" style="margin:5px 0; width: 100%; padding: 5px;" min="1" />
    <input type="number" id="modalPrice" placeholder="Price per unit (⚡)" style="margin:5px 0; width: 100%; padding: 5px;" min="1" />
    <div style="margin-top: 10px;">
      <button id="confirmModal" class="confirm-button">Confirm</button>
      <button id="cancelModal" class="cancel-button">Cancel</button>
    </div>
  `;

  modalOverlay.appendChild(modalBox);
  document.body.appendChild(modalOverlay);

  document.getElementById("confirmModal").addEventListener("click", async () => {
    const quantity = parseInt(document.getElementById("modalQuantity").value, 10);
    const price = parseInt(document.getElementById("modalPrice").value, 10);
    if (isNaN(quantity) || isNaN(price) || quantity <= 0 || price <= 0) {
      alert('⚠️ Please enter valid positive numbers.');
      return;
    }
    const endpoint = type === 'sale' ? '/api/oil/offer-sale' : '/api/oil/offer-buy';
    await submitOffer(endpoint, quantity, price);
    modalOverlay.remove();
  });

  document.getElementById("cancelModal").addEventListener("click", () => {
    modalOverlay.remove();
  });
}

async function submitOffer(url, quantity, price) {
  const token = localStorage.getItem("token");
  if (!token) return alert('You must be logged in!');

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ quantity, price_per_unit: price }),
    });

    const result = await response.json();
    if (response.ok) {
      showConfirmationPopup(`✅ ${result.message}`);
      fetchVoltBalance();
      await loadOrderBook();
    } else {
      showConfirmationPopup(`❌ Offer failed: ${result.error}`);
    }
  } catch (error) {
    console.error('Error submitting offer:', error);
    showConfirmationPopup('❌ Failed to create offer.');
  }
}


//
// SPECIAL RULES FOR LOGGED IN
//
function showRedeemModal(itemName) {
  const token = localStorage.getItem("token");
  if (!token) {
    alert('Please log in first!');
    return;
  }

  const existingModal = document.getElementById('redeemModal');
  if (existingModal) existingModal.remove();

  const modalOverlay = document.createElement('div');
  modalOverlay.className = 'modal-overlay';
  modalOverlay.id = 'redeemModal';

  const modalBox = document.createElement('div');
  modalBox.className = 'modal-box redeem-modal-box';
  modalBox.innerHTML = `
    <h2>ARE YOU SURE YOU WANT TO USE ${itemName}?</h2>
    <p style="margin-bottom: 8px;">Paste your Solana wallet address:</p>
    <div class="redeem-wallet-row">
      <textarea id="redeemWalletAddress" class="redeem-wallet-input" placeholder="Solana wallet address" rows="2" spellcheck="false" autocomplete="off" autocapitalize="off"></textarea>
      <button id="redeemWalletEdit" class="redeem-wallet-edit" type="button" aria-label="Edit wallet address" title="Edit wallet address">✎</button>
    </div>
    <div id="redeemWalletHint" class="redeem-wallet-hint" aria-live="polite"></div>
    <div class="modal-buttons">
      <button id="redeemConfirmButton" class="confirm-button">YES, USE IT</button>
      <button id="redeemCancelButton" class="cancel-button">CANCEL</button>
    </div>
  `;

  modalOverlay.appendChild(modalBox);
  document.body.appendChild(modalOverlay);

  const walletInput = document.getElementById('redeemWalletAddress');
  const walletHint = document.getElementById('redeemWalletHint');
  const walletEditButton = document.getElementById('redeemWalletEdit');
  if (walletEditButton) {
    walletEditButton.style.display = 'none';
    walletEditButton.addEventListener('click', () => {
      if (!walletInput) return;
      walletInput.readOnly = false;
      walletInput.classList.remove('is-readonly');
      walletInput.focus();
      walletInput.select();
      if (walletHint) {
        walletHint.textContent = 'Editing enabled. Double-check the address.';
      }
    });
  }
  if (walletInput) {
    walletInput.addEventListener('click', async () => {
      if (!walletInput.value || !walletInput.readOnly) return;
      try {
        await navigator.clipboard.writeText(walletInput.value);
        walletInput.select();
        if (walletHint) {
          walletHint.textContent = 'Copied wallet address to clipboard.';
        }
      } catch (error) {
        console.error('Error copying wallet address:', error);
      }
    });
  }
  const discordUserId = localStorage.getItem('discordUserID');
  if (discordUserId && walletInput) {
    fetch(`/api/holder/${discordUserId}`, {
      headers: getAuthHeaders(),
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((holder) => {
        if (holder?.walletAddress && !walletInput.value) {
          walletInput.value = holder.walletAddress;
          walletInput.readOnly = true;
          walletInput.classList.add('is-readonly');
          if (walletHint) {
            walletHint.textContent = 'Auto-filled from Robo-Check holder profile.';
          }
          if (walletEditButton) {
            walletEditButton.style.display = 'inline-flex';
          }
        }
      })
      .catch((error) => {
        console.error('Error auto-filling redeem wallet address:', error);
      });
  }

  const close = () => modalOverlay.remove();
  document.getElementById('redeemCancelButton').addEventListener('click', close);

  document.getElementById('redeemConfirmButton').addEventListener('click', async () => {
    const walletAddress = document.getElementById('redeemWalletAddress').value.trim();
    if (!walletAddress) {
      showConfirmationPopup('❌ Please paste your Solana wallet address.');
      return;
    }

    try {
      const response = await fetch('/api/redeem', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ itemName, walletAddress }),
      });
      const result = await response.json();
      if (response.ok) {
        showConfirmationPopup(`✅ ${result.message}`);
        await fetchInventory();
      } else {
        showConfirmationPopup(`❌ ${result.error || 'Failed to redeem item.'}`);
      }
    } catch (error) {
      console.error('Error redeeming item:', error);
      showConfirmationPopup('❌ Failed to redeem item.');
    } finally {
      close();
    }
  });
}

// Function to handle inventory click events dynamically
function handleInventoryClickEvents() {
  const token = localStorage.getItem("token"); // Check if user is logged in

  document.querySelectorAll(".inventory-item").forEach((itemElement) => {
    const itemName = itemElement.getAttribute("data-name");
    const isRedeemable = itemElement.getAttribute("data-redeemable") !== '0';

    // Remove all existing event listeners by cloning & replacing
    const clonedElement = itemElement.cloneNode(true);
    itemElement.parentNode.replaceChild(clonedElement, itemElement);

    if (token) {
      // ✅ LOGGED IN: Redeem flow
      clonedElement.addEventListener("click", () => {
        if (!isRedeemable) {
          showConfirmationPopup(`❌ "${itemName}" is not redeemable.`);
          return;
        }
        showRedeemModal(itemName);
      });
    } else {
      // 🚀 NOT LOGGED IN: Add click event to copy command & open Discord
      clonedElement.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(`%use "${itemName}"`);
          alert(
            `Copied to clipboard: %use "${itemName}"\n\nClick OK to go to Discord and use your item!`
          );
        } catch (err) {
          console.error("Clipboard copy failed:", err);
          alert("Failed to copy. Please copy manually.");
        }

        window.open(
          "https://discord.com/channels/1014872741846974514/1336779333641179146",
          "_blank"
        );
      });
    }
  });
}

// Call this function AFTER inventory is fetched and rendered
async function fetchInventory() {
  const token = localStorage.getItem("token");
  if (!token) {
    alert('Please log in first!');
    return;
  }

  try {
    currentInventoryRoutePath = '';
    const selfName = localStorage.getItem('username');
    currentProfileUserId = localStorage.getItem('discordUserID') || null;
    currentProfileUsername = selfName || currentProfileUserId;
    currentProfileRoutePath = selfName
      ? `username/${encodeURIComponent(selfName)}`
      : (currentProfileUserId ? encodeURIComponent(currentProfileUserId) : null);
    setInventoryHeader(selfName, true, currentProfileUserId);
    const response = await fetch('/api/inventory', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      throw new Error('Failed to fetch inventory');
    }

    const data = await response.json();
    const inventoryItems = document.getElementById('inventoryItems');
    inventoryItems.innerHTML = ''; // Clear existing content

    if (!data.length) {
      inventoryItems.innerHTML = '<p class="no-items">You have no items in your inventory.</p>';
      return;
    }

    data.forEach((item) => {
      const itemContainer = document.createElement('div');
      itemContainer.className = 'inventory-item raffle-item bg-content border border-accent rounded-lg p-3 my-2 shadow-md text-primary';
      itemContainer.setAttribute("data-name", item.name);
      itemContainer.setAttribute("data-redeemable", item.isRedeemable ? '1' : '0');

      // Item title
      const itemTitle = document.createElement('h3');
      itemTitle.className = 'font-bold text-highlight uppercase tracking-wide text-center';
      itemTitle.textContent = `${item.name} (Qty: ${item.quantity})`;
      itemContainer.appendChild(itemTitle);

      // Item description
      const descriptionSpan = document.createElement('p');
      descriptionSpan.className = 'text-body text-primary';
      descriptionSpan.innerHTML = item.description.replace(
        /\[([^\]]+)\]\(([^)]+)\)/g,
        '<a href="$2" target="_blank" class="link">$1</a>'
      );
      itemContainer.appendChild(descriptionSpan);

      inventoryItems.appendChild(itemContainer);
    });

    // 🔥 Re-attach event listeners dynamically after items are added
    handleInventoryClickEvents();
  } catch (error) {
    console.error('Error fetching inventory:', error);
    inventoryItems.innerHTML = '<p class="error-text text-red-500">Error loading inventory.</p>';
  }
}







  // ------------------------------
  // Back Buttons
  // ------------------------------
  document.querySelectorAll('.back-button').forEach((backButton) => {
    backButton.addEventListener('click', () => {
      showSection('landingPage');
    });
  });

  const viewSolariansButton = document.getElementById('viewSolariansButton');
  const closeSolariansButton = document.getElementById('closeSolariansButton');
  const solarianMosaic = document.getElementById('solarianMosaic');
  if (viewSolariansButton && solarianMosaic) {
    viewSolariansButton.addEventListener('click', () => {
      solarianMosaic.classList.remove('mosaic-hidden');
      renderSolarianMosaic(currentUserTokens);
    });
  }

  if (closeSolariansButton && solarianMosaic) {
    closeSolariansButton.addEventListener('click', () => {
      solarianMosaic.classList.add('mosaic-hidden');
    });
  }

  if (solarianMosaic) {
    solarianMosaic.addEventListener('click', (event) => {
      if (event.target === solarianMosaic) {
        solarianMosaic.classList.add('mosaic-hidden');
      }
    });
  }

  window.addEventListener('resize', () => {
    if (!solarianMosaic || solarianMosaic.classList.contains('mosaic-hidden')) return;
    renderSolarianMosaic(currentUserTokens);
  });

  syncSectionFromHash();
});
