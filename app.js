/**
 * Image to JSON Description App
 * Logic for handling file uploads, previews, and Gemini API calls.
 */

// DOM Elements
const fileInput = document.getElementById('fileInput');
const dropZone = document.getElementById('dropZone');
const previewCard = document.getElementById('previewCard');
const previewImg = document.getElementById('previewImg');
const fileNameDisplay = document.getElementById('fileName');
const fileSizeDisplay = document.getElementById('fileSize');
const removeFileBtn = document.getElementById('removeFileBtn');
const generateBtn = document.getElementById('generateBtn');
const jsonOutput = document.getElementById('jsonOutput');
const apiKeyInput = document.getElementById('apiKeyInput');
const saveKeyBtn = document.getElementById('saveKeyBtn');
const loadingOverlay = document.getElementById('loadingOverlay');
const copyBtn = document.getElementById('copyBtn');
const toast = document.getElementById('toast');

// Constants
const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

// State
let currentFile = null;
let currentBase64 = null;
let selectedModelId = null; // Dynamically determined

// Helper: Toast
function showToast(message) {
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

// Helper: Safe Storage
const safeStorage = {
    getItem: (key) => {
        try {
            return localStorage.getItem(key);
        } catch (e) {
            console.warn('LocalStorage access denied:', e);
            return null;
        }
    },
    setItem: (key, value) => {
        try {
            localStorage.setItem(key, value);
            return true;
        } catch (e) {
            console.warn('LocalStorage access denied:', e);
            alert('Cannot save API Key due to browser security settings (local file execution). Key will be used for this session only.');
            return false;
        }
    }
};

// Initialize
function init() {
    loadApiKey();
    setupEventListeners();
}

function loadApiKey() {
    const key = safeStorage.getItem('gemini_api_key');
    if (key) {
        apiKeyInput.value = key;
        // Optionally valid key here, but we'll validate on save or generate
    }
}

function setupEventListeners() {
    // API Key
    saveKeyBtn.addEventListener('click', async () => {
        const key = apiKeyInput.value.trim();
        if (key) {
            if (safeStorage.setItem('gemini_api_key', key)) {
                showToast('API Key Saved. Verifying...');
                // Verify and find model
                const model = await findBestModel(key);
                if (model) {
                    selectedModelId = model;
                    showToast(`Ready! Using model: ${model.replace('models/', '')}`);
                } else {
                    showToast('Warning: No suitable Vision model found for this key.');
                }
            }
        } else {
            showToast('Please enter an API Key first.');
        }
    });

    // File Input - Browse Button
    document.querySelector('.file-trigger').addEventListener('click', () => {
        fileInput.click();
    });

    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            handleFile(e.target.files[0]);
        }
    });

    // Drag & Drop
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('drag-over');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('drag-over');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-over');
        if (e.dataTransfer.files.length > 0) {
            handleFile(e.dataTransfer.files[0]);
        }
    });

    // Remove File
    removeFileBtn.addEventListener('click', clearFile);

    // Generate Button
    generateBtn.addEventListener('click', generateDescription);

    // Copy Button
    copyBtn.addEventListener('click', () => {
        const text = jsonOutput.innerText;
        if (text && text !== '// JSON output will appear here...') {
            navigator.clipboard.writeText(text).then(() => {
                const originalText = copyBtn.innerHTML;
                copyBtn.innerHTML = `
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                    Copied!
                `;
                setTimeout(() => {
                    copyBtn.innerHTML = originalText;
                }, 2000);
            });
        }
    });
}

// Store global JSON data to access properties later
let lastGeneratedData = null;

function updatePromptDisplay() {
    if (!lastGeneratedData || !lastGeneratedData.prompts_variantes) {
        promptOutput.value = "No prompts generated yet. Upload an image and click Generate.";
        return;
    }
    const model = promptModelSelector.value;
    const variant = lastGeneratedData.prompts_variantes[model] || "Prompt not available for this model.";
    promptOutput.value = variant;
}

/**
 * Dynamically find a model that supports vision generation.
 */
async function findBestModel(apiKey) {
    try {
        const response = await fetch(`${BASE_URL}/models?key=${apiKey}`);
        const data = await response.json();

        if (data.error) {
            console.error('ListModels Error:', data.error);
            return null;
        }

        const models = data.models || [];

        // Priority list: Flash > Pro > Flash-001 > Pro-Vision
        const candidates = [
            'models/gemini-1.5-flash',
            'models/gemini-1.5-flash-latest',
            'models/gemini-1.5-flash-001',
            'models/gemini-1.5-pro',
            'models/gemini-1.5-pro-latest',
            'models/gemini-pro-vision'
        ];

        // Filter models that support generateContent
        const availableModels = models.filter(m =>
            m.supportedGenerationMethods &&
            m.supportedGenerationMethods.includes('generateContent')
        ).map(m => m.name);

        // Find first match
        for (const candidate of candidates) {
            if (availableModels.includes(candidate)) {
                console.log('Selected Model:', candidate);
                return candidate;
            }
        }

        // If no priority match, take first available that looks like gemini
        const fallback = availableModels.find(m => m.includes('gemini'));
        if (fallback) return fallback;

        return null;
    } catch (e) {
        console.error('Error listing models:', e);
        return 'models/gemini-1.5-flash'; // Fallback to safe default
    }
}

function handleFile(file) {
    // Validate file type
    const validTypes = ['image/jpeg', 'image/png', 'image/jpg', 'image/webp'];
    if (!validTypes.includes(file.type)) {
        showToast('Please upload a valid image (JPG, PNG).');
        return;
    }

    // Validate size (5MB limit for example)
    if (file.size > 5 * 1024 * 1024) {
        showToast('File size exceeds 5MB limit.');
        return;
    }

    currentFile = file;
    fileNameDisplay.textContent = file.name;
    fileSizeDisplay.textContent = formatBytes(file.size);

    // Read file for preview and base64
    const reader = new FileReader();
    reader.onload = (e) => {
        currentBase64 = e.target.result.split(',')[1]; // Remove data URL prefix
        previewImg.src = e.target.result;

        // UI updates
        dropZone.parentElement.style.display = 'none'; // Hide upload box
        previewCard.style.display = 'flex'; // Show preview
        generateBtn.disabled = false;
    };
    reader.readAsDataURL(file);
}

function clearFile() {
    currentFile = null;
    currentBase64 = null;
    fileInput.value = ''; // Reset input

    // UI updates
    dropZone.parentElement.style.display = 'block';
    previewCard.style.display = 'none';
    generateBtn.disabled = true;
    jsonOutput.textContent = '// JSON output will appear here...';
    if (window.hljs) hljs.highlightElement(jsonOutput);
}

function formatBytes(bytes, decimals = 1) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

async function generateDescription() {
    const apiKey = apiKeyInput.value.trim();
    if (!apiKey) {
        showToast('Please enter your Gemini API Key first.');
        apiKeyInput.focus();
        return;
    }

    if (!currentBase64) return;

    // Ensure we have a model
    if (!selectedModelId) {
        showToast('Finding best model...');
        selectedModelId = await findBestModel(apiKey);
        if (!selectedModelId) {
            showToast('Error: Could not find a supported Gemini model.');
            return;
        }
    }

    // Show loading
    loadingOverlay.style.display = 'flex';
    generateBtn.disabled = true;

    try {
        const prompt = `Analiza esta imagen y genera un JSON descriptivo con el siguiente formato exacto, en español:
{
  "descripcion_general": {
    "tema": "string",
    "accion_principal": "string",
    "vibra": "string"
  },
  "personajes": [
    {
      "id": "string",
      "posicion": "string",
      "genero": "string",
      "apariencia": "string",
      "ropa": "string",
      "accesorios": "string",
      "detalle_adicional": "string"
    }
  ],
  "entorno": {
    "lugar": "string",
    "elementos_fondo": ["string"],
    "mobiliario": "string"
  },
  "estetica_tecnica": {
    "iluminacion": "string",
    "paleta_colores": ["string"],
    "estilo_imagen": "string"
  },
  "prompt_sugerido_nano": "string"
}
Retorna SOLO el JSON válido.`;

        const response = await fetch(`${BASE_URL}/${selectedModelId}:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                contents: [{
                    parts: [
                        { text: prompt },
                        {
                            inline_data: {
                                mime_type: currentFile.type,
                                data: currentBase64
                            }
                        }
                    ]
                }],
                generationConfig: {
                    temperature: 0.4,
                    topK: 32,
                    topP: 1,
                    maxOutputTokens: 2048,
                },
                safetySettings: [
                    { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
                    { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
                    { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
                    { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
                ]
            })
        });

        const data = await response.json();

        if (data.error) {
            // Check for potential model errors and retry if needed (optional, but good)
            throw new Error(data.error.message);
        }

        // Check for safety blocks or other finish reasons
        const candidate = data.candidates?.[0];
        if (!candidate) {
            throw new Error("No candidates returned. The model might be overloaded.");
        }

        if (candidate.finishReason && candidate.finishReason !== "STOP") {
            console.warn("Generation stopped early:", candidate);
            if (candidate.finishReason === "SAFETY") {
                throw new Error("Generation blocked by Safety Filters. (Try a different image)");
            }
            // Continue if there is partial content? usually not useful for JSON.
        }

        let resultText = candidate.content?.parts?.[0]?.text;

        if (resultText) {
            // Clean up Markdown code blocks if present
            resultText = resultText.replace(/```json/g, '').replace(/```/g, '').trim();

            // Format JS Object
            try {
                const jsonObj = JSON.parse(resultText);
                const formattedJson = JSON.stringify(jsonObj, null, 2);
                jsonOutput.textContent = formattedJson;
                if (window.hljs) hljs.highlightElement(jsonOutput);

            } catch (e) {
                console.error("JSON Parse Error", e);
                jsonOutput.textContent = resultText; // Show raw text if parse fails
            }
        } else {
            throw new Error('No content generated.');
        }

    } catch (error) {
        console.error('API Error:', error);
        alert('Error generating description: ' + error.message);
        jsonOutput.textContent = '// Error occurred. Check console for details.';
    } finally {
        loadingOverlay.style.display = 'none';
        generateBtn.disabled = false;
    }
}

// Tutorial Logic
class Tutorial {
    constructor(steps) {
        this.steps = steps;
        this.currentStep = 0;
        this.overlay = document.getElementById('tutorialOverlay');
        this.tooltip = document.getElementById('tutorialTooltip');
        this.title = document.getElementById('tutorialTitle');
        this.text = document.getElementById('tutorialText');
        this.counter = document.getElementById('tutorialStepCount');
        this.nextBtn = document.getElementById('tutorialNextBtn');

        this.nextBtn.addEventListener('click', () => this.next());
    }

    start() {
        if (!this.steps || this.steps.length === 0) return;
        this.overlay.classList.remove('hidden');
        this.showStep(0);
    }

    showStep(index) {
        // Clean up previous highlight
        if (this.currentStep >= 0 && this.currentStep < this.steps.length) {
            const prevEl = document.querySelector(this.steps[this.currentStep].selector);
            if (prevEl) prevEl.classList.remove('highlight-target');
        }

        this.currentStep = index;
        const step = this.steps[index];
        const el = document.querySelector(step.selector);

        if (!el) {
            this.end(); // Element missing, abort
            return;
        }

        // Highlight
        el.classList.add('highlight-target');

        // Content
        this.title.textContent = step.title;
        this.text.textContent = step.text;
        this.counter.textContent = `${index + 1}/${this.steps.length}`;
        this.nextBtn.textContent = (index === this.steps.length - 1) ? 'Finish' : 'Next';

        // Positioning
        this.positionTooltip(el, step.position || 'bottom');
    }

    positionTooltip(targetEl, position) {
        const rect = targetEl.getBoundingClientRect();
        const tooltipRect = this.tooltip.getBoundingClientRect();
        const margin = 15;

        // Reset classes
        this.tooltip.classList.remove('top', 'bottom', 'left', 'right');
        this.tooltip.classList.add(position);

        let top, left;

        // Simple positioning logic
        if (position === 'bottom') {
            top = rect.bottom + margin;
            left = rect.left;
        } else if (position === 'top') {
            top = rect.top - tooltipRect.height - margin;
            left = rect.left;
        } else if (position === 'left') {
            top = rect.top;
            left = rect.left - tooltipRect.width - margin;
        } else if (position === 'right') {
            top = rect.top;
            left = rect.right + margin;
        }

        // Boundary checks (basic)
        if (left < 10) left = 10;
        if (left + tooltipRect.width > window.innerWidth) left = window.innerWidth - tooltipRect.width - 10;

        this.tooltip.style.top = `${top}px`;
        this.tooltip.style.left = `${left}px`;
    }

    next() {
        const prevEl = document.querySelector(this.steps[this.currentStep].selector);
        if (prevEl) prevEl.classList.remove('highlight-target');

        if (this.currentStep < this.steps.length - 1) {
            this.showStep(this.currentStep + 1);
        } else {
            this.end();
        }
    }

    end() {
        this.overlay.classList.add('hidden');
        safeStorage.setItem('tutorial_seen', 'true');
    }
}

// Start
init();
// Check for tutorial
window.addEventListener('load', () => {
    // Check if seen
    const seen = safeStorage.getItem('tutorial_seen');
    if (!seen) {
        // Define steps
        const steps = [
            {
                selector: '.api-key-container',
                title: '1. Enter API Key',
                text: 'Start by pasting your Gemini API Key here. We need this to communicate with Google\'s AI.',
                position: 'bottom'
            },
            {
                selector: '#saveKeyBtn',
                title: '2. Save & Verify',
                text: 'Click the save button. The app will check if your key works and find the best available model for you.',
                position: 'bottom'
            },
            {
                selector: '.upload-card',
                title: '3. Upload Image',
                text: 'Drag & drop an image here, or click to browse. We support JPG and PNG.',
                position: 'right'
            },
            {
                selector: '#generateBtn',
                title: '4. Generate',
                text: 'Once uploaded, click here! The AI will analyze the photo and create your detailed JSON.',
                position: 'top'
            }
        ];

        setTimeout(() => {
            const tour = new Tutorial(steps);
            tour.start();
        }, 500); // Slight delay for rendering
    }
});
