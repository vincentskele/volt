document.addEventListener('DOMContentLoaded', () => {
    const sections = document.querySelectorAll('.content');
    const landingPage = document.getElementById('landingPage');

    // Utility function to fetch data and populate a target element
    async function fetchData(url, targetElement) {
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
            targetElement.innerHTML = data.length
                ? data
                      .map((item) =>
                          Object.values(item)
                              .map((value) => `<span>${value}</span>`)
                              .join(' - ')
                      )
                      .map((content) => `<li>${content}</li>`)
                      .join('')
                : '<li>No data available.</li>';
        } catch (error) {
            console.error(`Error fetching data from ${url}:`, error);
            targetElement.innerHTML = '<li>Error loading data.</li>';
        }
    }

    // Show a section and hide others
    function showSection(sectionId) {
        sections.forEach((section) => (section.style.display = 'none'));
        const sectionToShow = document.getElementById(sectionId);
        if (sectionToShow) {
            sectionToShow.style.display = 'block';
        } else {
            console.error(`Section with ID ${sectionId} not found.`);
        }
    }

    // Add event listeners for buttons
    const showLeaderboardButton = document.getElementById('showLeaderboardButton');
    if (showLeaderboardButton) {
        showLeaderboardButton.addEventListener('click', () => {
            const leaderboardList = document.getElementById('leaderboardList');
            if (!leaderboardList) {
                console.error('Leaderboard list element not found!');
                return;
            }

            fetchData('/api/leaderboard', leaderboardList);
            showSection('leaderboard');
        });
    } else {
        console.error('Show Leaderboard Button not found.');
    }

    const showAdminListButton = document.getElementById('showAdminListButton');
    if (showAdminListButton) {
        showAdminListButton.addEventListener('click', () => {
            const adminListContent = document.getElementById('adminListContent');
            if (!adminListContent) {
                console.error('Admin list element not found!');
                return;
            }

            fetchData('/api/admins', adminListContent);
            showSection('adminList');
        });
    } else {
        console.error('Show Admin List Button not found.');
    }

    const showShopButton = document.getElementById('showShopButton');
    if (showShopButton) {
        showShopButton.addEventListener('click', () => {
            const shopItems = document.getElementById('shopItems');
            if (!shopItems) {
                console.error('Shop items element not found!');
                return;
            }

            fetchData('/api/shop', shopItems);
            showSection('shop');
        });
    } else {
        console.error('Show Shop Button not found.');
    }

    const showJobListButton = document.getElementById('showJobListButton');
    if (showJobListButton) {
        showJobListButton.addEventListener('click', () => {
            const jobListContent = document.getElementById('jobListContent');
            if (!jobListContent) {
                console.error('Job list element not found!');
                return;
            }

            fetchData('/api/jobs', jobListContent);
            showSection('jobList');
        });
    } else {
        console.error('Show Job List Button not found.');
    }

    const showGiveawayListButton = document.getElementById('showGiveawayListButton');
    if (showGiveawayListButton) {
        showGiveawayListButton.addEventListener('click', () => {
            const giveawayItems = document.getElementById('giveawayItems');
            if (!giveawayItems) {
                console.error('Giveaway list element not found!');
                return;
            }

            fetchData('/api/giveaways', giveawayItems);
            showSection('giveawayList');
        });
    } else {
        console.error('Show Giveaway List Button not found.');
    }

    // Back button functionality
    document.querySelectorAll('.back-button').forEach((backButton) => {
        backButton.addEventListener('click', () => {
            showSection('landingPage');
        });
    });
});
