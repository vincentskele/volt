document.addEventListener('DOMContentLoaded', () => {
  const sections = document.querySelectorAll('.content');
  const SERVER_ID = '1014872741846974514'; // Hardcoded Discord server ID

  // Show one section, hide all others
  function showSection(sectionId) {
    sections.forEach((section) => (section.style.display = 'none'));
    const sectionToShow = document.getElementById(sectionId);
    if (sectionToShow) {
      sectionToShow.style.display = 'block';
    }
  }

  // Format data depending on the endpoint type
  function getFormatter(type) {
    const formatters = {
      leaderboard: (item) => `User: ${item.userTag} | Wallet: ${item.wallet} | Bank: ${item.bank} | Total: ${item.totalBalance}`,
      admins: (item) => `Admin: ${item.userTag}`,
      shop: (item) => `[${item.id}] ${item.name} - ${item.price} | Qty: ${item.quantity ?? 'N/A'} | Desc: ${item.description ?? ''}`,
      jobs: (job) => `[${job.jobID}] ${job.description}`,
      giveaways: (item) => `Giveaway #${item.id} — Prize: "${item.prize}" — Ends: ${item.end_time ? new Date(item.end_time).toLocaleString() : 'N/A'}`,
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

// Leaderboard
const showLeaderboardButton = document.getElementById('showLeaderboardButton');
if (showLeaderboardButton) {
  showLeaderboardButton.addEventListener('click', () => {
    const leaderboardList = document.getElementById('leaderboardList');

    fetch('/api/leaderboard')
      .then((response) => response.json())
      .then((leaderboard) => {
        leaderboardList.innerHTML = ''; // Clear existing content

        leaderboard.forEach((entry, index) => {
          const item = document.createElement('div');
          item.className = 'leaderboard-item';

          const userLink = document.createElement('a');
          userLink.href = `https://discord.com/users/${entry.userID}`;
          userLink.target = '_blank';
          userLink.textContent = `${index + 1}. ${entry.userTag}`; // Add ranking number

          const details = document.createElement('span');
          details.innerHTML = `
            Wallet: ${entry.wallet} | Bank: ${entry.bank} | Total: ${entry.total}
          `;

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



// Admin List
const showAdminListButton = document.getElementById('showAdminListButton');
if (showAdminListButton) {
  showAdminListButton.addEventListener('click', () => {
    const adminListContent = document.getElementById('adminListContent');

    fetch('/api/admins')
      .then((response) => response.json())
      .then((admins) => {
        adminListContent.innerHTML = ''; // Clear existing content
        admins.forEach((admin) => {
          const adminLink = document.createElement('a');
          adminLink.href = `https://discord.com/users/${admin.userID}`;
          adminLink.target = '_blank'; // Open in a new tab
          adminLink.textContent = admin.userTag;

          const listItem = document.createElement('div');
          listItem.className = 'admin-item'; // Add the new class
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


  // 3) Shop
  const showShopButton = document.getElementById('showShopButton');
  if (showShopButton) {
    showShopButton.addEventListener('click', () => {
      const shopItems = document.getElementById('shopItems');
      fetchData('/api/shop', shopItems, 'shop');
      showSection('shop');
    });
  }

  // 4) Jobs
  const showJobListButton = document.getElementById('showJobListButton');
  const jobListContent = document.getElementById('jobListContent');

  async function fetchJobs() {
    try {
      const res = await fetch('/api/jobs');
      const jobs = await res.json();

      if (!jobs.length) {
        jobListContent.innerHTML = '<p>No jobs available.</p>';
      } else {
        let html = `
          <h2>Available Jobs</h2>
          <button id="refreshJobs" class="refresh-button">🔄 Refresh</button>
          <ul>
        `;

        jobs.forEach((job) => {
          html += `<li>[${job.jobID}] ${job.description}</li>`;
        });

        html += `</ul>`;

        jobListContent.innerHTML = html;

        // Attach event listener to the new Refresh button
        document.getElementById('refreshJobs').addEventListener('click', fetchJobs);
      }
    } catch (error) {
      console.error('Error fetching jobs:', error);
      jobListContent.innerHTML = '<p>Error loading jobs.</p>';
    }
  }

  if (showJobListButton) {
    showJobListButton.addEventListener('click', () => {
      fetchJobs();
      showSection('jobList');
    });
  }

  // 5) Giveaways
  const showGiveawayListButton = document.getElementById('showGiveawayListButton');
  const giveawayItems = document.getElementById('giveawayItems');

  async function fetchGiveaways() {
    try {
      // Fetch active giveaways
      const res = await fetch('/api/giveaways/active');
      const giveaways = await res.json();

      if (!giveaways.length) {
        giveawayItems.innerHTML = '<p>No active giveaways at the moment.</p>';
      } else {
        let html = `
          <h2>Active Giveaways</h2>
          <button id="refreshGiveaways" class="refresh-button">🔄 Refresh</button>
        `;

        // Reverse the order to show the newest first
        giveaways.reverse().forEach((g) => {
          const endTime = new Date(parseInt(g.end_time)).toLocaleString();
          const giveawayLink = `https://discord.com/channels/${SERVER_ID}/${g.channel_id}/${g.message_id}`;

          html += `
            <div class="giveaway-item">
              <p><a href="${giveawayLink}" target="_blank">Click here and react to enter giveaway!</a></p>
              <p><strong>End Time:</strong> ${endTime}</p>
              <p><strong>Prize:</strong> ${g.prize}</p>
            </div>
          `;
        });

        giveawayItems.innerHTML = html;

        // Attach event listener to the new Refresh button
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

  // Back buttons → Return to landing page
  document.querySelectorAll('.back-button').forEach((backButton) => {
    backButton.addEventListener('click', () => {
      showSection('landingPage');
    });
  });
});
