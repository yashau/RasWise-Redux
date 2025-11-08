// RasWise Mini App - Shared JavaScript Utilities

// Initialize Telegram Web App
const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();

// Set theme colors
tg.setHeaderColor('#3b82f6');
tg.setBackgroundColor('#ffffff');

// Utility functions
const MiniApp = {
    // Get URL parameters
    getParams() {
        return new URLSearchParams(window.location.search);
    },

    // Get user ID from Telegram
    getUserId() {
        return tg.initDataUnsafe?.user?.id;
    },

    // Get init data for API requests
    getInitData() {
        return tg.initData || '';
    },

    // Make authenticated API request
    async apiRequest(endpoint, options = {}) {
        const defaultOptions = {
            headers: {
                'X-Telegram-Init-Data': this.getInitData(),
                ...options.headers
            }
        };

        const response = await fetch(window.location.origin + endpoint, {
            ...options,
            ...defaultOptions,
            headers: { ...defaultOptions.headers, ...options.headers }
        });

        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Request failed' }));
            throw new Error(error.error || 'Request failed');
        }

        // Handle empty responses
        const text = await response.text();
        if (!text) {
            return { success: true };
        }

        try {
            return JSON.parse(text);
        } catch (e) {
            console.error('Failed to parse JSON:', text);
            throw new Error('Invalid response from server');
        }
    },

    // Show error message
    showError(message, containerId = 'error') {
        const errorEl = document.getElementById(containerId);
        if (errorEl) {
            errorEl.textContent = message;
            errorEl.style.display = 'block';
        }
        this.hideLoading();
    },

    // Hide error message
    hideError(containerId = 'error') {
        const errorEl = document.getElementById(containerId);
        if (errorEl) {
            errorEl.style.display = 'none';
        }
    },

    // Show loading state
    showLoading(containerId = 'loading', message = null) {
        const loadingEl = document.getElementById(containerId);
        if (loadingEl) {
            // Update message if provided
            if (message) {
                const messageEl = loadingEl.querySelector('p');
                if (messageEl) {
                    messageEl.textContent = message;
                }
            }
            loadingEl.style.display = 'block';
        }
    },

    // Hide loading state
    hideLoading(containerId = 'loading') {
        const loadingEl = document.getElementById(containerId);
        if (loadingEl) {
            loadingEl.style.display = 'none';
        }
    },

    // Show empty state
    showEmptyState(containerId = 'empty-state') {
        const emptyEl = document.getElementById(containerId);
        if (emptyEl) {
            emptyEl.style.display = 'block';
        }
    },

    // Hide empty state
    hideEmptyState(containerId = 'empty-state') {
        const emptyEl = document.getElementById(containerId);
        if (emptyEl) {
            emptyEl.style.display = 'none';
        }
    },

    // Format currency
    formatCurrency(amount, currency = '$') {
        const formatted = parseFloat(amount).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
        return `${currency} ${formatted}`;
    },

    // Format date
    formatDate(timestamp) {
        return new Date(timestamp).toLocaleDateString();
    },

    // Format datetime
    formatDateTime(timestamp) {
        return new Date(timestamp).toLocaleString();
    },

    // Get initial of name
    getInitial(name) {
        if (!name) return '?';
        return name.charAt(0).toUpperCase();
    },

    // Close Mini App and send data back to bot
    sendDataAndClose(data) {
        tg.sendData(JSON.stringify(data));
    },

    // Just close the Mini App
    close() {
        tg.close();
    },

    // Show confirmation
    showConfirm(message, callback) {
        tg.showConfirm(message, callback);
    },

    // Show alert
    showAlert(message) {
        tg.showAlert(message);
    },

    // Show popup (notification)
    showPopup(message) {
        tg.showPopup({ message });
    },

    // Enable main button
    enableMainButton(text, callback) {
        tg.MainButton.setText(text);
        tg.MainButton.onClick(callback);
        tg.MainButton.show();
    },

    // Disable main button
    disableMainButton() {
        tg.MainButton.hide();
    },

    // Setup back button (or close button if at main menu)
    setupBackButton(url) {
        // If url is null/undefined, we're at the main menu - show close button
        if (!url) {
            tg.BackButton.hide();
            return;
        }

        tg.BackButton.onClick(() => {
            window.location.href = url;
        });
        tg.BackButton.show();
    },

    // Setup close button for main menu
    setupCloseButton() {
        tg.BackButton.hide();
        // User can use Telegram's native close gesture/button
    },

    // Hide back button
    hideBackButton() {
        tg.BackButton.hide();
    },

    // Haptic feedback
    haptic(style = 'medium') {
        if (tg.HapticFeedback) {
            // Check if it's a notification type (success, warning, error) or impact type
            if (['success', 'warning', 'error'].includes(style)) {
                tg.HapticFeedback.notificationOccurred(style);
            } else {
                // Impact types: 'light', 'medium', 'heavy', 'rigid', 'soft'
                tg.HapticFeedback.impactOccurred(style);
            }
        }
    },

    // Vibrate
    vibrate() {
        if (navigator.vibrate) {
            navigator.vibrate(50);
        }
    },

    // Lightbox for viewing images (single or carousel)
    openLightbox(imageUrl, title) {
        // If imageUrl is an array, open carousel
        if (Array.isArray(imageUrl)) {
            this.openCarousel(imageUrl, title);
            return;
        }

        let lightbox = document.getElementById('lightbox');

        // Create lightbox if it doesn't exist
        if (!lightbox) {
            lightbox = document.createElement('div');
            lightbox.id = 'lightbox';
            lightbox.className = 'lightbox';
            lightbox.innerHTML = `
                <div class="lightbox-content">
                    <button class="lightbox-close" onclick="MiniApp.closeLightbox()">×</button>
                    <img id="lightbox-img" src="" alt="">
                </div>
            `;
            document.body.appendChild(lightbox);

            // Close on background click
            lightbox.addEventListener('click', (e) => {
                if (e.target === lightbox) {
                    this.closeLightbox();
                }
            });
        }

        // Set image and show
        const img = document.getElementById('lightbox-img');
        img.src = imageUrl;
        img.alt = title || 'Photo';
        lightbox.classList.add('active');
        this.haptic('light');
    },

    // Carousel lightbox for multiple images
    openCarousel(images, title) {
        if (!images || images.length === 0) return;

        let carousel = document.getElementById('carousel-lightbox');

        // Create carousel if it doesn't exist
        if (!carousel) {
            carousel = document.createElement('div');
            carousel.id = 'carousel-lightbox';
            carousel.className = 'lightbox';
            carousel.innerHTML = `
                <div class="lightbox-content carousel-content">
                    <button class="lightbox-close" onclick="MiniApp.closeCarousel()">×</button>
                    <div class="carousel-header">
                        <h3 id="carousel-title"></h3>
                        <div id="carousel-counter"></div>
                    </div>
                    <div class="carousel-container">
                        <button class="carousel-prev" id="carousel-prev">‹</button>
                        <img id="carousel-img" src="" alt="">
                        <button class="carousel-next" id="carousel-next">›</button>
                    </div>
                </div>
            `;
            document.body.appendChild(carousel);

            // Close on background click
            carousel.addEventListener('click', (e) => {
                if (e.target === carousel) {
                    this.closeCarousel();
                }
            });
        }

        // Store images array
        this._carouselImages = images;
        this._carouselIndex = 0;

        // Setup navigation
        document.getElementById('carousel-prev').onclick = () => this.carouselPrev();
        document.getElementById('carousel-next').onclick = () => this.carouselNext();

        // Set title
        document.getElementById('carousel-title').textContent = title || 'Transfer Slips';

        // Show first image
        this.updateCarousel();
        carousel.classList.add('active');
        this.haptic('light');
    },

    carouselPrev() {
        if (this._carouselIndex > 0) {
            this._carouselIndex--;
            this.updateCarousel();
            this.haptic('light');
        }
    },

    carouselNext() {
        if (this._carouselIndex < this._carouselImages.length - 1) {
            this._carouselIndex++;
            this.updateCarousel();
            this.haptic('light');
        }
    },

    updateCarousel() {
        const img = document.getElementById('carousel-img');
        const counter = document.getElementById('carousel-counter');
        const prevBtn = document.getElementById('carousel-prev');
        const nextBtn = document.getElementById('carousel-next');

        img.src = this._carouselImages[this._carouselIndex];
        counter.textContent = `${this._carouselIndex + 1} / ${this._carouselImages.length}`;

        // Disable/enable buttons based on position
        prevBtn.disabled = this._carouselIndex === 0;
        nextBtn.disabled = this._carouselIndex === this._carouselImages.length - 1;

        prevBtn.style.opacity = prevBtn.disabled ? '0.3' : '1';
        nextBtn.style.opacity = nextBtn.disabled ? '0.3' : '1';
    },

    closeCarousel() {
        const carousel = document.getElementById('carousel-lightbox');
        if (carousel) {
            carousel.classList.remove('active');
        }
        this._carouselImages = null;
        this._carouselIndex = 0;
    },

    closeLightbox() {
        const lightbox = document.getElementById('lightbox');
        if (lightbox) {
            lightbox.classList.remove('active');
        }
        // Also close carousel if open
        this.closeCarousel();
    }
};

// File upload helper
class FileUploadHandler {
    constructor(inputId, previewId) {
        this.input = document.getElementById(inputId);
        this.preview = document.getElementById(previewId);
        this.file = null;

        if (this.input) {
            this.input.addEventListener('change', (e) => {
                this.file = e.target.files[0];
                if (this.preview) {
                    this.preview.textContent = this.file ? '✓ ' + this.file.name : '';
                }
            });
        }
    }

    getFile() {
        return this.file;
    }

    hasFile() {
        return this.file !== null;
    }

    reset() {
        this.file = null;
        if (this.input) this.input.value = '';
        if (this.preview) this.preview.textContent = '';
    }
}

// Export for use in other scripts
window.MiniApp = MiniApp;
window.FileUploadHandler = FileUploadHandler;
