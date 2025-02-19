document.addEventListener('DOMContentLoaded', () => {
  const sections = document.querySelectorAll('.content');
  const SERVER_ID = '1014872741846974514'; // Hardcoded Discord server ID

  // Show one section, hide all others
  function showSection(sectionId) {
    sections.forEach((section) => {
      section.style.display = 'none';
    });
    const sectionToShow = document.getElementById(sectionId);
    if (sectionToShow) {
      sectionToShow.style.display = 'block';
    }
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
  // Leaderboard Section
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

            const userLink = document.createElement('a');
            userLink.href = `https://discord.com/users/${entry.userID}`;
            userLink.target = '_blank';
            userLink.textContent = `${index + 1}. ${entry.userTag}`;
            userLink.className = 'user-link';

            const total = entry.wallet + entry.bank;
            const details = document.createElement('span');
            details.innerHTML = `Solarian: ${entry.wallet} | Battery Bank: ${entry.bank} | Total: ${total || 0}`;
            details.className = 'details';

            item.appendChild(userLink);
            item.appendChild(details);
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
  // SHOP SECTION
  // ==================
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
        shopItems.innerHTML = ''; // Clear any existing content

        data.forEach((item) => {
          // Create a container for each shop item.
          const itemContainer = document.createElement('div');
          itemContainer.className = 'shop-item';
          itemContainer.style.cursor = 'pointer'; // Make it clear it's clickable

          // Create a span for the item details
          const detailsSpan = document.createElement('span');
          detailsSpan.textContent = `${item.name} - ⚡${item.price} | Qty: ${item.quantity} `;
          itemContainer.appendChild(detailsSpan);

          // Create a span for the description with markdown support
          const descriptionSpan = document.createElement('span');
          const descriptionHTML = item.description.replace(
            /\[([^\]]+)\]\(([^)]+)\)/g,
            '<a href="$2" target="_blank" class="link">$1</a>'
          );
          descriptionSpan.innerHTML = descriptionHTML;
          itemContainer.appendChild(descriptionSpan);

          // Add a click event to copy command and open Discord
          itemContainer.addEventListener('click', async () => {
            const command = `%buy "${item.name}"`;

            try {
              await navigator.clipboard.writeText(command);
              console.log(`Command copied: ${command}`);
              alert(
                `Copied to clipboard: ${command}\n\nClick OK to go to Discord. Paste and send to buy!`
              );
            } catch (err) {
              console.error('Clipboard copy failed:', err);
              alert('Failed to copy to clipboard. Please copy manually.');
            }

            // Open Discord in a new tab
            const discordURL =
              'https://discord.com/channels/1014872741846974514/1336779333641179146';
            console.log(`Opening Discord: ${discordURL}`);
            window.open(discordURL, '_blank');
          });

          // Append to shop list
          shopItems.appendChild(itemContainer);
        });

        showSection('shop');
      } catch (error) {
        console.error('Error fetching shop data:', error);
      }
    });
  }

  // ================================================
// INVENTORY SECTION (My Items)
// ================================================
const showInventoryButton = document.getElementById('showInventoryButton');
const inventorySection = document.getElementById('inventorySection');
const inventoryItems = document.getElementById('inventoryItems');

// This function fetches the user’s inventory from /api/inventory
async function fetchInventory() {
  // You’ll need a valid token in localStorage
  const token = localStorage.getItem('token');
  if (!token) {
    alert('Please log in first!');
    return;
  }

  try {
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
    // data should be an array of items the user owns

    inventoryItems.innerHTML = ''; // Clear existing

    if (!data.length) {
      inventoryItems.innerHTML = '<li>You have no items in your inventory.</li>';
      return;
    }

    // Render each item in the inventory
    data.forEach((item) => {
      const itemContainer = document.createElement('div');
      itemContainer.className = 'inventory-item';
      itemContainer.style.cursor = 'pointer';

      // Item details
      const detailsSpan = document.createElement('span');
      detailsSpan.textContent = `${item.name} (Qty: ${item.quantity}) `;
      itemContainer.appendChild(detailsSpan);

      // Description with markdown
      const descriptionSpan = document.createElement('span');
      const descriptionHTML = item.description.replace(
        /\[([^\]]+)\]\(([^)]+)\)/g,
        '<a href="$2" target="_blank" class="link">$1</a>'
      );
      descriptionSpan.innerHTML = descriptionHTML;
      itemContainer.appendChild(descriptionSpan);

      // Click to copy /use command
      itemContainer.addEventListener('click', async () => {
        const command = `%use "${item.name}"`;
        try {
          await navigator.clipboard.writeText(command);
          alert(
            `Copied to clipboard: ${command}\n\nClick OK to go to Discord. Paste and send to use your item!`
          );
        } catch (err) {
          console.error('Clipboard copy failed:', err);
          alert('Failed to copy. Please copy manually.');
        }
        // Optionally open Discord
        window.open(
          'https://discord.com/channels/1014872741846974514/1336779333641179146',
          '_blank'
        );
      });

      inventoryItems.appendChild(itemContainer);
    });
  } catch (error) {
    console.error('Error fetching inventory:', error);
    inventoryItems.innerHTML = '<li>Error loading inventory.</li>';
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
  // Jobs Section
  // ------------------------------
  const showJobListButton = document.getElementById('showJobListButton');
  const jobListContent = document.getElementById('jobListContent');

  async function resolveUsername(userId) {
    try {
      const res = await fetch(`/api/resolveUser/${userId}`);
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
      jobListContent.innerHTML = '<p>Loading jobs...</p>';
      const res = await fetch('/api/jobs');
      const jobs = await res.json();
      if (!jobs.length) {
        jobListContent.innerHTML = '<p class="no-jobs-message">No jobs available at the moment. Please check back later.</p>';
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
        await Promise.all(channelIdMatches.map(async (match) => {
          const channelId = match.slice(2, -1);
          const channelName = await resolveChannelName(channelId);
          description = description.replace(
            new RegExp(`<#${channelId}>`, 'g'),
            `<a href="https://discord.com/channels/${channelId}" target="_blank" class="link">#${channelName}</a>`
          );
        }));
        description = description.replace(
          /\[([^\]]+)\]\(([^)]+)\)/g,
          '<a href="$2" target="_blank" class="link">$1</a>'
        );
        const jobItem = document.createElement('div');
        jobItem.className = 'job-item';
        jobItem.innerHTML = `<p><strong>Job:</strong> ${description}</p>`;
        if (job.assignees && Array.isArray(job.assignees) && job.assignees.length > 0) {
          const assigneeLinks = await Promise.all(job.assignees.map(async (userId) => {
            const username = await resolveUsername(userId);
            return `<a href="https://discord.com/users/${userId}" target="_blank" class="link">@${username}</a>`;
          }));
          jobItem.innerHTML += `<p>Assigned to: ${assigneeLinks.join(', ')}</p>`;
        } else {
          jobItem.innerHTML += `<p>Not assigned</p>`;
        }
        jobList.appendChild(jobItem);
      }
      jobListContent.appendChild(jobList);
    } catch (error) {
      console.error('Error fetching jobs:', error.message, error.stack);
      jobListContent.innerHTML = '<p>Error loading jobs. Please try again later.</p>';
    }
  }

  if (showJobListButton) {
    showJobListButton.addEventListener('click', () => {
      fetchJobs();
      showSection('jobList');
    });
  }

// ------------------------------
// Giveaways Section
// ------------------------------
const showGiveawayListButton = document.getElementById('showGiveawayListButton');
const giveawayItems = document.getElementById('giveawayItems');

async function fetchGiveaways() {
  try {
    const res = await fetch('/api/giveaways/active');
    const giveaways = await res.json();

    if (!giveaways.length) {
      giveawayItems.innerHTML = '<p>No active giveaways at the moment.</p>';
    } else {
      let html = ''; // No refresh button

      // Formatting options: Month (full), Day (numeric), Hour & Minute (12-hour clock)
      const options = {
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        hour12: true,
      };

      // Reverse the list if you want the newest first.
      giveaways.reverse().forEach((g) => {
        // Ensure the end_time is in milliseconds.
        let timestamp = parseInt(g.end_time, 10);
        if (timestamp.toString().length === 10) {
          timestamp *= 1000;
        }

        // Format the date in the user's local time zone.
        const endTime = new Date(timestamp).toLocaleString(undefined, options);

        const giveawayLink = `https://discord.com/channels/${SERVER_ID}/${g.channel_id}/${g.message_id}`;
        html += `
          <div class="giveaway-item">
            <p class="giveaway-name">${g.giveaway_name}</p>
            <div class="giveaway-content">
              <p>
                <a href="${giveawayLink}" target="_blank">
                  Click here and react to enter giveaway!
                </a>
              </p>
              <p><strong>End Time:</strong> ${endTime}</p>
              <p><strong>Prize:</strong> ${g.prize}</p>
              <p><strong>Winners:</strong> ${g.winners}</p>
            </div>
          </div>
        `;
      });

      giveawayItems.innerHTML = html;
    }
  } catch (error) {
    console.error('Error fetching giveaways:', error);
    giveawayItems.innerHTML = '<p>Error loading giveaways.</p>';
  }
}

if (showGiveawayListButton) {
  showGiveawayListButton.addEventListener('click', () => {
    fetchGiveaways();
    showSection('giveawayList'); // Assumes showSection() is defined elsewhere
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
const voltMenuContainer = document.getElementById('voltMenuContainer');

// Ensure Volt elements are hidden initially
if (voltMenuContainer) voltMenuContainer.style.display = 'none';

// Check if user is already logged in
const token = localStorage.getItem('token');

if (token) {
  console.log('✅ User is already logged in');
  showPostLoginButtons(); // Show inventory & logout buttons immediately
}

if (loginButton) {
  console.log('✅ Login button found:', loginButton);

  loginButton.addEventListener('click', async (event) => {
    event.preventDefault();
    console.log('🚀 Login button clicked!');

    const username = usernameInput.value.trim();
    const password = passwordInput.value;

    if (!username || !password) {
      console.error('❌ Please enter both username and password.');
      alert('Please enter both username and password.');
      return;
    }

    try {
      console.log('🔄 Sending login request...');

      const response = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });

      const data = await response.json();

      if (response.ok) {
        console.log('✅ Login successful:', data);

        // Store JWT token in localStorage
        localStorage.setItem('token', data.token);

        // Show the post-login buttons (Inventory & Logout)
        showPostLoginButtons();
      } else {
        console.error('❌ Login failed:', data.message);
        alert(`Login failed: ${data.message}`);
      }
    } catch (error) {
      console.error('❌ Error during login:', error);
      alert('An error occurred. Please try again.');
    }
  });
} else {
  console.error('❌ Login button NOT found!');
}

/**
 * Replace the login form with 2 stacked buttons (MY INVENTORY + LOGOUT).
 */
function showPostLoginButtons() {
  console.log('🔄 Replacing login form with MY INVENTORY + LOGOUT buttons...');

  // Hide login inputs & labels
  usernameInput.style.display = 'none';
  passwordInput.style.display = 'none';
  if (usernameLabel) usernameLabel.style.display = 'none';
  if (passwordLabel) passwordLabel.style.display = 'none';

  // Hide the original login button
  loginButton.style.display = 'none';

  // Create a container for the two buttons, top-right corner
  const userActionContainer = document.createElement('div');
  userActionContainer.style.position = 'absolute';
  userActionContainer.style.top = '10px';
  userActionContainer.style.right = '10px';
  userActionContainer.style.display = 'flex';
  userActionContainer.style.flexDirection = 'column';
  userActionContainer.style.alignItems = 'flex-end';

  // ========== MY INVENTORY BUTTON ==========
  const inventoryButton = document.createElement('button');
  inventoryButton.textContent = 'Items';
  // Match your button styling
  inventoryButton.className = 'btn text-sm font-bold h-6 px-3';
  inventoryButton.style.height = '19px';
  inventoryButton.style.minHeight = '19px';
  inventoryButton.style.lineHeight = '19px';
  inventoryButton.style.padding = '0 12px';
  inventoryButton.style.marginBottom = '6px'; // spacing above logout

  // On click, fetch inventory & show the inventory page
  inventoryButton.addEventListener('click', () => {
    if (typeof fetchInventory === 'function') {
      fetchInventory();
    }
    if (typeof showSection === 'function') {
      showSection('inventorySection');
    }
  });

  // ========== LOGOUT BUTTON ==========
  const logoutButton = document.createElement('button');
  logoutButton.textContent = 'LOGOUT';
  logoutButton.className = 'btn text-sm font-bold h-6 px-3';
  logoutButton.style.height = '19px';
  logoutButton.style.minHeight = '19px';
  logoutButton.style.lineHeight = '19px';
  logoutButton.style.padding = '0 12px';

  logoutButton.addEventListener('click', () => {
    console.log('🚪 Logging out...');
    localStorage.removeItem('token'); // Remove token
    location.reload(); // Reload page to reset UI
  });

  // Add both buttons to the container
  userActionContainer.appendChild(inventoryButton);
  userActionContainer.appendChild(logoutButton);

  // Finally, attach to the DOM
  document.body.appendChild(userActionContainer);

  // ✅ Show the Volt menu only after login
  if (voltMenuContainer) voltMenuContainer.style.display = 'block';

  // Fetch the user's Volt balance
  fetchVoltBalance();
}


document.addEventListener('DOMContentLoaded', () => {
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

/**
 * Fetch Volt Balance from API (only if logged in).
 */
async function fetchVoltBalance() {
  try {
    const token = localStorage.getItem('token');
    if (!token) return;

    const response = await fetch('/api/volt-balance', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();
    if (response.ok) {
      document.getElementById('voltBalance').textContent = data.balance || '0 Volts';
    } else {
      console.error('❌ Failed to fetch Volt balance:', data.message);
      document.getElementById('voltBalance').textContent = 'Error loading';
    }
  } catch (error) {
    console.error('❌ Error fetching Volt balance:', error);
    document.getElementById('voltBalance').textContent = 'Error loading';
  }
}













//========================
// Raffles
//========================
(function () {
  // Utility: Show only the specified section
  const sections = ["landingPage", "rafflesSection"];
  function showSection(sectionId) {
    sections.forEach((id) => {
      document.getElementById(id).style.display = id === sectionId ? "block" : "none";
    });
  }

  const showRafflesButton = document.getElementById("showRafflesButton");
  const rafflesSection = document.getElementById("rafflesSection");
  const rafflesList = document.getElementById("rafflesList");
  const rafflesBackButton = rafflesSection.querySelector(".back-button");

  // Prevent multiple API calls
  let isRaffleListLoading = false;

  // Ensure only one event listener exists
  showRafflesButton.removeEventListener("click", handleShowRaffles);
  showRafflesButton.addEventListener("click", handleShowRaffles);

  async function handleShowRaffles() {
    showSection("rafflesSection");
    await populateRaffleList();
  }

  rafflesBackButton.addEventListener("click", () => {
    showSection("landingPage");
  });

  async function populateRaffleList() {
    if (isRaffleListLoading) return;
    isRaffleListLoading = true;

    rafflesList.innerHTML = ""; // Clears old items before rendering

    try {
      const response = await fetch("/api/shop");
      const data = await response.json();

      // Group by name and sum quantities
      const raffleMap = new Map();
      data.forEach((item) => {
        if (item.name.toLowerCase().includes("raffle ticket")) {
          const normalizedName = item.name.trim().toLowerCase(); // Normalize names

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

        // Click event: copy buy command and open Discord
        itemContainer.addEventListener("click", async () => {
          const command = `%buy "${item.originalName}"`;
          try {
            await navigator.clipboard.writeText(command);
            alert(`Copied to clipboard: ${command}\n\nClick OK to go to the discord command, hit paste and send to buy.`);
          } catch (err) {
            alert("Failed to copy. Please copy manually.");
          }
          window.open("https://discord.com/channels/1014872741846974514/1336779333641179146", "_blank");
        });

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

// Starts (or restarts) the countdown timer.
let countdownInterval;
function startCountdownTimer() {
  updateCountdown();
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



  // ------------------------------
  // Back Buttons
  // ------------------------------
  document.querySelectorAll('.back-button').forEach((backButton) => {
    backButton.addEventListener('click', () => {
      showSection('landingPage');
    });
  });
});
