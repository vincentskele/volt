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

  // ------------------------------
  // Shop Section
  // ------------------------------
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
        shopItems.innerHTML = '';
        data.forEach(item => {
          const button = document.createElement('button');
          button.className = 'shop-item';
          const description = item.description.replace(
            /\[([^\]]+)\]\(([^)]+)\)/g,
            '<a href="$2" target="_blank" class="link">$1</a>'
          );
          button.innerHTML = `${item.name} - ⚡${item.price} | Qty: ${item.quantity} | ${description}`;
          shopItems.appendChild(button);
        });
        showSection('shop');
      } catch (error) {
        console.error('Error fetching shop data:', error);
      }
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
        let html = `<button id="refreshGiveaways" class="refresh-button">🔄 Refresh</button>`;
        giveaways.reverse().forEach((g) => {
          const endTime = new Date(parseInt(g.end_time)).toLocaleString();
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
        document.getElementById('refreshGiveaways').addEventListener('click', fetchGiveaways);
      }
    } catch (error) {
      console.error('Error fetching giveaways:', error);
      giveawayItems.innerHTML = '<p>Error loading giveaways.</p>';
    }
  }

  if (showGiveawayListButton) {
    showGiveawayListButton.addEventListener('click', () => {
      fetchGiveaways();
      showSection('giveawayList');
    });
  }

  // ------------------------------
  // Daily Tasks Section with Countdown Timer (resets at midnight EST)
  // ------------------------------
  function getNextMidnightEST() {
    const now = new Date();
    const nowEST = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
    const nextMidnightEST = new Date(nowEST);
    nextMidnightEST.setDate(nowEST.getDate() + 1);
    nextMidnightEST.setHours(0, 0, 0, 0);
    return nextMidnightEST;
  }

  function updateCountdown() {
    const countdownElem = document.getElementById("countdownTimer");
    if (!countdownElem) return;
    
    const now = new Date();
    const nextMidnight = getNextMidnightEST();
    const diff = nextMidnight - now;
    
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);
    
    countdownElem.innerText = `${hours.toString().padStart(2, '0')}:` +
                              `${minutes.toString().padStart(2, '0')}:` +
                              `${seconds.toString().padStart(2, '0')}`;
  }

  let countdownInterval;

  function startCountdownTimer() {
    updateCountdown();
    if (countdownInterval) clearInterval(countdownInterval);
    countdownInterval = setInterval(updateCountdown, 1000);
  }

  const showDailyTasksButton = document.getElementById('showDailyTasksButton');
  if (showDailyTasksButton) {
    showDailyTasksButton.addEventListener('click', () => {
      showSection('dailyTasksPage');
      startCountdownTimer();
    });
  }

// ------------------------------
// Console Section with Rolling Updates
// ------------------------------
const showConsoleButton = document.getElementById("showConsoleButton");
let consoleUpdateInterval = null; // Store interval reference

if (showConsoleButton) {
  showConsoleButton.addEventListener("click", () => {
    showSection("consoleSection");
    fetchAndDisplayConsoleLogs(); // Fetch immediately
    startConsoleUpdates(); // Start rolling updates
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

    // Ensure logs is an array
    if (!Array.isArray(logs)) {
      logs = logs.logs || Object.values(logs);
    }

    const consoleLogs = document.getElementById("consoleLogs");
    if (!consoleLogs) return;
    consoleLogs.innerHTML = "";

    if (logs.length === 0) {
      consoleLogs.innerHTML = `<li class="log-item">No logs available.</li>`;
      return;
    }

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
          hour12: true, // Ensures AM/PM format
        });
      }

      const li = document.createElement("li");
      li.className = "log-item";
      li.innerHTML = `<strong>[${formattedTime}]</strong> ${message}`;
      consoleLogs.appendChild(li);
    });

  } catch (error) {
    console.error("Error fetching console logs:", error);
    document.getElementById("consoleLogs").innerHTML =
      `<li class="log-item error">⚠️ Error loading logs. Please try again later.</li>`;
  }
}

// Start rolling updates every 5 seconds
function startConsoleUpdates() {
  if (consoleUpdateInterval) clearInterval(consoleUpdateInterval); // Prevent multiple intervals
  consoleUpdateInterval = setInterval(fetchAndDisplayConsoleLogs, 5000);
}

// Stop updates when leaving the console section
function stopConsoleUpdates() {
  if (consoleUpdateInterval) {
    clearInterval(consoleUpdateInterval);
    consoleUpdateInterval = null;
  }
}

// Detect when user leaves the console section
document.querySelectorAll(".back-button").forEach(button => {
  button.addEventListener("click", stopConsoleUpdates);
});



  // ------------------------------
  // Back Buttons
  // ------------------------------
  document.querySelectorAll('.back-button').forEach((backButton) => {
    backButton.addEventListener('click', () => {
      showSection('landingPage');
    });
  });
});
