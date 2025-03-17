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
    console.log(`[DEBUG] Job assignment response:`, result);

    if (response.ok) {
      showConfirmationPopup(`✅ Successfully assigned to job: "${result.job.description}"`);
      fetchJobs(); // Refresh the job list
    } else {
      showConfirmationPopup(`❌ Job assignment failed: ${result.error}`);
    }
  } catch (error) {
    console.error(`[ERROR] Error assigning job:`, error);
    showConfirmationPopup('❌ Error assigning job.');
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
    showConfirmationPopup('❌ You must be logged in to quit your job.');
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
    } else {
      showConfirmationPopup(`❌ ${result.error}`);
    }
  } catch (error) {
    console.error('❌ Error quitting job:', error);
    showConfirmationPopup('❌ Failed to quit job. Please try again later.');
  }
}

// ✅ Keep the original modal open/close functionality
document.addEventListener("click", (event) => {
  const modal = document.getElementById("jobSubmissionModal");

  if (event.target && event.target.id === "submitJobButton") {
    console.log("✅ Submit Job button clicked!");
    
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
    console.log("✅ Submit Job button clicked!");
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
      showStyledAlert("⚠️ Please select a job first.", 3000);
      return;
    }

    const job = await getJobById(selectedJobID);
    if (!job) {
      showStyledAlert("❌ Job not found! Please select a valid job.", 3000);
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
        showStyledAlert("✅ Job submitted successfully!", 3000);
        modal.style.display = "none";
      } else {
        showStyledAlert(`❌ Submission failed: ${result.error}`, 3000);
      }
    } catch (error) {
      console.error("❌ Error submitting job:", error);
      showStyledAlert("❌ Failed to submit job.", 3000);
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
      } else {
        showConfirmationPopup(`❌ You have left the giveaway.`);
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
const voltMenuContainer = document.getElementById('voltMenuContainer');

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


/**
 * Replace the login form with 2 stacked buttons (INVENTORY + LOGOUT).
 */
function showPostLoginButtons() {
  console.log('🔄 Replacing login form with INVENTORY + LOGOUT buttons...');

  // Hide login inputs & labels
  const usernameInput = document.getElementById('loginUsername');
  const passwordInput = document.getElementById('loginPassword');
  const loginButton = document.getElementById('submitLogin');
  const usernameLabel = document.querySelector('label[for="loginUsername"]');
  const passwordLabel = document.querySelector('label[for="loginPassword"]');
  const voltMenuContainer = document.getElementById('voltMenuContainer');

  if (usernameInput) usernameInput.style.display = 'none';
  if (passwordInput) passwordInput.style.display = 'none';
  if (usernameLabel) usernameLabel.style.display = 'none';
  if (passwordLabel) passwordLabel.style.display = 'none';
  if (loginButton) loginButton.style.display = 'none';

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
    location.reload(); // Reload page to reset UI
  });

  // Add both buttons to the container
  userActionContainer.appendChild(inventoryButton);
  userActionContainer.appendChild(logoutButton);

  // Attach to the DOM
  document.body.appendChild(userActionContainer);

  // ✅ Show the Volt menu only after login
  if (voltMenuContainer) voltMenuContainer.style.display = 'block';

  // Fetch the user's Volt balance
  fetchVoltBalance();
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

/**
 * Fetch Volt Balance from API (only if logged in).
 */
async function fetchVoltBalance() {
  try {
    const token = localStorage.getItem('token');
    if (!token) return;

    const response = await fetch(`/api/volt-balance?nocache=${new Date().getTime()}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();
    if (response.ok) {
      document.getElementById('voltBalance').textContent = `${data.balance}`;
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
   * Show a confirmation modal before purchasing a raffle ticket.
   * @param {Object} item - Raffle item details.
   */
  function showRaffleConfirmation(item) {
    const modalOverlay = document.createElement("div");
    modalOverlay.className = "modal-overlay";

    const modalBox = document.createElement("div");
    modalBox.className = "modal-box";
    modalBox.innerHTML = `
      <h2>CONFIRM PURCHASE</h2>
      <p>Are you sure you want to buy:</p>
      <p><strong>${item.originalName}</strong> for ⚡${item.price}?</p>
      <div class="modal-buttons">
        <button class="confirm-button" id="confirmRafflePurchase">CONFIRM</button>
        <button class="cancel-button" id="cancelRafflePurchase">CANCEL</button>
      </div>
    `;

    modalOverlay.appendChild(modalBox);
    document.body.appendChild(modalOverlay);

    document.getElementById("confirmRafflePurchase").addEventListener("click", () => {
      modalOverlay.remove();
      buyRaffleTicket(item.originalName);
    });

    document.getElementById("cancelRafflePurchase").addEventListener("click", () => {
      modalOverlay.remove();
    });
  }

  /**
   * Send purchase request for the raffle ticket.
   * @param {string} itemName - Name of the raffle ticket to buy.
   */
  async function buyRaffleTicket(itemName) {
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
        body: JSON.stringify({ itemName }),
      });
  
      const result = await response.json();
      if (response.ok) {
        showConfirmationPopup(`✅ Purchase successful! You bought "${itemName}".`);
        // Force refresh Volt balance after purchase
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
});
