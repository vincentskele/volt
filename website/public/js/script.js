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

          // When clicked, fetch and display the inventory for that user
          item.addEventListener('click', () => {
            fetchUserInventory(entry.userID);
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
async function fetchUserInventory(userID) {
  try {
    const response = await fetch(`/api/public-inventory/${userID}`);
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

        // Event for clicking to use the item
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
    }
    showSection('inventorySection');
  } catch (error) {
    console.error('Error fetching user inventory:', error);
    alert('Failed to load user inventory.');
  }
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

let adminPollingIntervalId = null;
function startAdminPolling() {
  if (adminPollingIntervalId) return;
  adminPollingIntervalId = setInterval(() => {
    const adminPage = document.getElementById('adminPage');
    if (adminPage && adminPage.style.display === 'block') {
      loadAdminPage();
    }
  }, 15000);
}

let chatPollingIntervalId = null;
let chatLoading = false;
async function loadChatMessages() {
  const token = localStorage.getItem('token');
  const chatMessages = document.getElementById('chatMessages');
  if (!token || !chatMessages) return;

  try {
    if (chatLoading) return;
    chatLoading = true;
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
          showSection('userProfileSection');
        }
      });

      const text = document.createElement('span');
      text.textContent = `: ${msg.message}`;

      row.appendChild(name);
      row.appendChild(text);
      chatMessages.appendChild(row);
    });

    chatMessages.scrollTop = chatMessages.scrollHeight;
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
    loadChatMessages();
  } catch (error) {
    console.error('❌ Failed to send chat message:', error);
    showConfirmationPopup('❌ Failed to send message.');
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
  const token = localStorage.getItem('token');
  if (!token) return;

  try {
    const response = await fetch('/api/admin/check', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return;

    const data = await response.json();
    if (!data?.isAdmin) return;

    const adminButton = document.createElement('button');
    adminButton.textContent = 'ADMIN';
    adminButton.className = 'btn text-sm font-bold';
    adminButton.style.height = '24px';
    adminButton.style.width = '110px';
    adminButton.style.lineHeight = '24px';
    adminButton.style.padding = '0 12px';
    adminButton.style.textAlign = 'center';

    adminButton.addEventListener('click', () => {
      loadAdminPage();
      startAdminPolling();
      if (typeof showSection === 'function') {
        showSection('adminPage');
      }
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

  // Create a container for the two buttons, top-right corner
  const userActionContainer = document.createElement('div');
  userActionContainer.id = 'userButtons';
  userActionContainer.style.position = 'absolute';
  userActionContainer.style.top = '10px';
  userActionContainer.style.right = '10px';
  userActionContainer.style.display = 'flex';
  userActionContainer.style.flexDirection = 'column';
  userActionContainer.style.alignItems = 'flex-end';
  userActionContainer.style.gap = '4px'; // Keep spacing between buttons

  // ========== INVENTORY BUTTON ==========
  const inventoryButton = document.createElement('button');
  inventoryButton.textContent = 'INVENTORY';
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
  userProfileButton.textContent = 'PROFILE';
  userProfileButton.className = 'btn text-sm font-bold';
  userProfileButton.style.height = '24px';
  userProfileButton.style.width = '110px';
  userProfileButton.style.lineHeight = '24px';
  userProfileButton.style.padding = '0 12px';
  userProfileButton.style.textAlign = 'center';

  userProfileButton.addEventListener('click', () => {
    if (typeof showSection === 'function') {
      showSection('userProfileSection');
    }
    fetchUserHoldings();
    fetchVoltBalance();
    fetchQuestStatus();
  });

  // ========== CHAT BUTTON ==========
  const chatButton = document.createElement('button');
  chatButton.textContent = 'CHAT';
  chatButton.className = 'btn text-sm font-bold';
  chatButton.style.height = '24px';
  chatButton.style.width = '110px';
  chatButton.style.lineHeight = '24px';
  chatButton.style.padding = '0 12px';
  chatButton.style.textAlign = 'center';

  chatButton.addEventListener('click', () => {
    loadChatMessages();
    startChatPolling();
    if (typeof showSection === 'function') {
      showSection('chatSection');
    }
  });

  // ========== LOGOUT BUTTON ==========
  const logoutButton = document.createElement('button');
  logoutButton.textContent = 'LOGOUT';
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
  userActionContainer.appendChild(chatButton);
  userActionContainer.appendChild(logoutButton);
  addAdminButton(userActionContainer, logoutButton);

  // Attach to the DOM
  if (voltMenuContainer && voltMenuContainer.parentNode) {
    voltMenuContainer.parentNode.insertBefore(userActionContainer, voltMenuContainer);
  } else {
    document.body.appendChild(userActionContainer);
  }

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

    document.getElementById("solarianBalance").textContent = `Solarian: ${wallet}`;
    document.getElementById("batteryBankBalance").textContent = `Battery Bank: ${bank}`;
    document.getElementById("totalBalance").textContent = `Total: ${totalBalance}`;

    const userProfileSolarian = document.getElementById('userProfileSolarianValue');
    if (userProfileSolarian) {
      userProfileSolarian.textContent = `Solarian: ${wallet}`;
    }

    console.log("✅ Volt Balance Updated:", { wallet, bank, totalBalance });

  } catch (error) {
    console.error("❌ Error fetching Volt balance:", error);
    document.getElementById("solarianBalance").textContent = "Error";
    document.getElementById("batteryBankBalance").textContent = "Error";
    document.getElementById("totalBalance").textContent = "Error";

    const userProfileSolarian = document.getElementById('userProfileSolarianValue');
    if (userProfileSolarian) {
      userProfileSolarian.textContent = 'Solarian: Error';
    }
  }
}

function safeText(value, fallback = 'Unknown') {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }
  return String(value);
}

let currentUserTokens = [];

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
  if (viewButton) {
    viewButton.textContent = `VIEW ALL ${tokens.length} SOLARIAN${tokens.length === 1 ? '' : 'S'}`;
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
        image.src = token.metadata.image;
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

  mosaicGrid.innerHTML = '';
  tokens.forEach((token) => {
    if (!token?.metadata?.image) return;
    const img = document.createElement('img');
    img.src = token.metadata.image;
    img.alt = 'Solarian';
    mosaicGrid.appendChild(img);
  });
}

async function fetchUserHoldingsFor(userId) {
  const grid = document.getElementById('userHoldingsGrid');
  const profileTitle = document.getElementById('userProfileTitle');
  if (!grid) return;

  grid.innerHTML = '<div class="empty-state">Loading holdings...</div>';

  if (!userId) {
    grid.innerHTML = '<div class="empty-state">No Discord ID found for this profile.</div>';
    if (profileTitle) profileTitle.textContent = '👤 User Profile';
    return;
  }

  try {
    let username = null;
    if (userId === localStorage.getItem('discordUserID')) {
      username = localStorage.getItem('username');
    } else {
      username = await resolveUsername(userId);
    }
    if (profileTitle) {
      profileTitle.textContent = `👤 ${username || userId}`;
    }

    const response = await fetch(`/api/holder/${userId}`);
    if (!response.ok) {
      throw new Error(`Failed to fetch holder data: ${response.statusText}`);
    }

    const holder = await response.json();
    if (!holder) {
      grid.innerHTML = '<div class="empty-state">No verified holder profile found.</div>';
      return;
    }

    renderUserHoldings(holder);
  } catch (error) {
    console.error('Error loading holdings:', error);
    grid.innerHTML = '<div class="empty-state">Could not load holdings data.</div>';
    if (profileTitle) profileTitle.textContent = '👤 User Profile';
  }
}

async function fetchUserHoldings() {
  const discordUserId = localStorage.getItem('discordUserID');
  return fetchUserHoldingsFor(discordUserId);
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
        showConfirmationPopup(`✅ You bought ${quantity} "${itemName}" ticket(s) for ⚡${price * quantity}.`);
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
function showConfirmationPopup(message) {
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
      <button id="confirmYes" class="confirm-button">Yes</button>
      <button id="confirmNo" class="cancel-button">No</button>
    </div>
  `;

  modalOverlay.appendChild(modalBox);
  document.body.appendChild(modalOverlay);

  document.getElementById("confirmYes").addEventListener("click", () => {
    onConfirm();
    modalOverlay.remove();
  });

  document.getElementById("confirmNo").addEventListener("click", () => {
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

    if (window.oilChartInstance) window.oilChartInstance.destroy();

    window.oilChartInstance = new Chart(oilChartCanvas, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Robot Oil Price (⚡ per barrel)',
          data: prices,
          borderColor: 'yellow',
          backgroundColor: 'rgba(255, 255, 0, 0.2)',
          borderWidth: 2,
          pointBackgroundColor: 'yellow',
          pointBorderColor: 'yellow'
        }]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { labels: { color: '#fafafa', font: { size: 14, weight: 'bold' } } },
          tooltip: { backgroundColor: '#27393F', titleColor: '#fafafa', bodyColor: '#fafafa' }
        },
        scales: {
          x: { grid: { color: '#405D67' }, ticks: { color: '#fafafa' } },
          y: { beginAtZero: true, grid: { color: '#405D67' }, ticks: { color: '#fafafa' } }
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
      div.innerHTML = `
        <span>🧑 ${listing.seller_id}</span>
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
// Function to handle inventory click events dynamically
function handleInventoryClickEvents() {
  const token = localStorage.getItem("token"); // Check if user is logged in

  document.querySelectorAll(".inventory-item").forEach((itemElement) => {
    const itemName = itemElement.getAttribute("data-name");

    // Remove all existing event listeners by cloning & replacing
    const clonedElement = itemElement.cloneNode(true);
    itemElement.parentNode.replaceChild(clonedElement, itemElement);

    if (token) {
      // ✅ LOGGED IN: Remove click events completely
      clonedElement.onclick = null;
      clonedElement.removeAttribute("onclick");
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
      renderSolarianMosaic(currentUserTokens);
      solarianMosaic.classList.remove('mosaic-hidden');
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
});
