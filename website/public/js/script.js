// public/js/script.js
document.addEventListener('DOMContentLoaded', () => {
    const sections = document.querySelectorAll('.content');
  
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
        leaderboard: (item) => {
          // Because the server now returns: { userTag, wallet, bank, totalBalance }
          return `User: ${item.userTag} | Wallet: ${item.wallet} | Bank: ${item.bank} | Total: ${item.totalBalance}`;
        },
        admins: (item) => {
          // Because the server returns: { userTag }
          return `Admin: ${item.userTag}`;
        },
        shop: (item) => {
          // Server returns: { id, name, price, description, quantity }
          let text = `[${item.id}] ${item.name} - $${item.price}`;
          if (item.quantity !== undefined) {
            text += ` | Qty: ${item.quantity}`;
          }
          if (item.description) {
            text += ` | Desc: ${item.description}`;
          }
          return text;
        },
        jobs: (job) => {
          // { jobID, description }
          return `[${job.jobID}] ${job.description}`;
        },
        giveaways: (item) => {
          // Suppose columns: id, end_time, prize, winners, ...
          const endTime = item.end_time
            ? new Date(item.end_time).toLocaleString()
            : 'N/A';
          return `Giveaway #${item.id} — Prize: "${item.prize}" — Ends: ${endTime} — Winners: ${item.winners}`;
        },
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
  
    // 1) Leaderboard
    const showLeaderboardButton = document.getElementById('showLeaderboardButton');
    if (showLeaderboardButton) {
      showLeaderboardButton.addEventListener('click', () => {
        const leaderboardList = document.getElementById('leaderboardList');
        fetchData('/api/leaderboard', leaderboardList, 'leaderboard');
        showSection('leaderboard');
      });
    }
  
    // 2) Admin List
    const showAdminListButton = document.getElementById('showAdminListButton');
    if (showAdminListButton) {
      showAdminListButton.addEventListener('click', () => {
        const adminListContent = document.getElementById('adminListContent');
        fetchData('/api/admins', adminListContent, 'admins');
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
    if (showJobListButton) {
      showJobListButton.addEventListener('click', () => {
        const jobListContent = document.getElementById('jobListContent');
        fetchData('/api/jobs', jobListContent, 'jobs');
        showSection('jobList');
      });
    }
  
    // 5) Giveaways
    const showGiveawayListButton = document.getElementById('showGiveawayListButton');
    if (showGiveawayListButton) {
      showGiveawayListButton.addEventListener('click', () => {
        const giveawayItems = document.getElementById('giveawayItems');
        // If you want *all* giveaways, use '/api/giveaways'.
        // If only active, use '/api/giveaways/active'.
        fetchData('/api/giveaways/active', giveawayItems, 'giveaways');
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
  