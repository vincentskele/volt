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
          let text = `[${item.id}] ${item.name} - ${item.price}`;
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
  
    const showGiveawayListButton = document.getElementById('showGiveawayListButton');
    if (showGiveawayListButton) {
      showGiveawayListButton.addEventListener('click', async () => {
        const giveawayItems = document.getElementById('giveawayItems');
        try {
          // Fetch active giveaways:
          const res = await fetch('/api/giveaways/active'); // Adjust API route if needed
          const giveaways = await res.json();
    
          if (!giveaways.length) {
            giveawayItems.innerHTML = '<p>No active giveaways at the moment.</p>';
          } else {
            let html = '<h2>Active Giveaways</h2>';
    
            giveaways.forEach((g) => {
              // Convert end_time to readable format
              const endTime = new Date(parseInt(g.end_time)).toLocaleString();
    
              // Build giveaway item HTML
              html += `
                <div class="giveaway-item">
                  <p><strong>Message Link:</strong> <a href="https://discord.com/channels/CHANNEL_ID/${g.message_id}" target="_blank">${g.message_id}</a></p>
                  <p><strong>End Time:</strong> ${endTime}</p>
                  <p><strong>Prize:</strong> ${g.prize}</p>
                </div>
              `;
            });
    
            giveawayItems.innerHTML = html;
          }
    
          // Reveal the giveaway list section
          showSection('giveawayList');
        } catch (error) {
          console.error('Error fetching giveaways:', error);
          giveawayItems.innerHTML = '<p>Error loading giveaways.</p>';
        }
      });
    }
    

    // Back buttons → Return to landing page
    document.querySelectorAll('.back-button').forEach((backButton) => {
      backButton.addEventListener('click', () => {
        showSection('landingPage');
      });
    });
  });
  