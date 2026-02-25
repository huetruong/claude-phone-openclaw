import axios from 'axios';
import { parsePhoneNumber, ParseError } from 'libphonenumber-js';

/**
 * Validate ElevenLabs API key by making a test request
 * @param {string} apiKey - ElevenLabs API key
 * @returns {Promise<{valid: boolean, error?: string}>} Validation result
 */
export async function validateElevenLabsKey(apiKey) {
  if (!apiKey || apiKey.trim() === '') {
    return {
      valid: false,
      error: 'API key cannot be empty'
    };
  }

  try {
    const response = await axios.get('https://api.elevenlabs.io/v1/voices', {
      headers: {
        'xi-api-key': apiKey
      },
      timeout: 10000
    });

    if (response.status === 200) {
      return { valid: true };
    }

    return {
      valid: false,
      error: `Unexpected status: ${response.status}`
    };
  } catch (error) {
    if (error.response) {
      if (error.response.status === 401) {
        return {
          valid: false,
          error: 'Invalid API key (401 Unauthorized)'
        };
      }
      return {
        valid: false,
        error: `API error: ${error.response.status} ${error.response.statusText}`
      };
    }

    if (error.code === 'ECONNABORTED') {
      return {
        valid: false,
        error: 'Request timeout - check your internet connection'
      };
    }

    return {
      valid: false,
      error: `Network error: ${error.message}`
    };
  }
}

/**
 * Validate OpenAI API key by making a test request
 * @param {string} apiKey - OpenAI API key
 * @returns {Promise<{valid: boolean, error?: string}>} Validation result
 */
export async function validateOpenAIKey(apiKey) {
  if (!apiKey || apiKey.trim() === '') {
    return {
      valid: false,
      error: 'API key cannot be empty'
    };
  }

  try {
    const response = await axios.get('https://api.openai.com/v1/models', {
      headers: {
        'Authorization': `Bearer ${apiKey}`
      },
      timeout: 10000
    });

    if (response.status === 200) {
      return { valid: true };
    }

    return {
      valid: false,
      error: `Unexpected status: ${response.status}`
    };
  } catch (error) {
    if (error.response) {
      if (error.response.status === 401) {
        return {
          valid: false,
          error: 'Invalid API key (401 Unauthorized)'
        };
      }
      return {
        valid: false,
        error: `API error: ${error.response.status} ${error.response.statusText}`
      };
    }

    if (error.code === 'ECONNABORTED') {
      return {
        valid: false,
        error: 'Request timeout - check your internet connection'
      };
    }

    return {
      valid: false,
      error: `Network error: ${error.message}`
    };
  }
}

/**
 * Validate SIP extension format
 * @param {string} extension - SIP extension number
 * @returns {boolean} True if valid
 */
export function validateExtension(extension) {
  return /^\d{4,5}$/.test(extension);
}

/**
 * Parse and validate a comma-separated list of phone numbers.
 * Accepts any international format and normalizes to E.164.
 * Returns an empty array if input is blank (no restriction).
 *
 * @param {string} input - Comma-separated phone numbers in any format
 * @param {string} [defaultCountry='US'] - ISO 3166-1 alpha-2 country code for national-format numbers
 * @returns {{ numbers: string[], error: string|null }}
 */
export function parseAllowFrom(input, defaultCountry = 'US') {
  if (!input || input.trim() === '') {
    return { numbers: [], error: null };
  }
  const entries = input.split(',').map(n => n.trim()).filter(n => n);
  const normalized = [];
  const invalid = [];

  for (const entry of entries) {
    try {
      const phone = parsePhoneNumber(entry, defaultCountry);
      if (phone && phone.isValid()) {
        normalized.push(phone.format('E.164'));
      } else {
        invalid.push(entry);
      }
    } catch (err) {
      if (err instanceof ParseError) {
        invalid.push(entry);
      } else {
        throw err;
      }
    }
  }

  if (invalid.length > 0) {
    return { numbers: [], error: `Could not parse phone numbers: ${invalid.join(', ')} — use E.164 (+15551234567) or national format with correct country configured` };
  }
  return { numbers: normalized, error: null };
}

/**
 * Validate IP address format
 * @param {string} ip - IP address
 * @returns {boolean} True if valid
 */
export function validateIP(ip) {
  const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (!ipv4Regex.test(ip)) {
    return false;
  }

  const parts = ip.split('.');
  return parts.every(part => {
    const num = parseInt(part, 10);
    return num >= 0 && num <= 255;
  });
}

/**
 * Validate hostname format
 * @param {string} hostname - Hostname or FQDN
 * @returns {boolean} True if valid
 */
export function validateHostname(hostname) {
  const hostnameRegex = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/i;
  return hostnameRegex.test(hostname);
}

/**
 * Validate ElevenLabs voice ID
 * @param {string} apiKey - ElevenLabs API key
 * @param {string} voiceId - Voice ID to validate
 * @returns {Promise<{valid: boolean, name?: string, error?: string}>} Validation result
 */
export async function validateVoiceId(apiKey, voiceId) {
  if (!voiceId || voiceId.trim() === '') {
    return {
      valid: false,
      error: 'Voice ID cannot be empty'
    };
  }

  try {
    const response = await axios.get(`https://api.elevenlabs.io/v1/voices/${voiceId}`, {
      headers: {
        'xi-api-key': apiKey
      },
      timeout: 10000
    });

    if (response.status === 200 && response.data.name) {
      return {
        valid: true,
        name: response.data.name
      };
    }

    return {
      valid: false,
      error: `Unexpected response: ${response.status}`
    };
  } catch (error) {
    if (error.response) {
      if (error.response.status === 404) {
        return {
          valid: false,
          error: 'Voice ID not found'
        };
      }
      if (error.response.status === 401) {
        return {
          valid: false,
          error: 'Invalid API key (cannot validate voice ID)'
        };
      }
      return {
        valid: false,
        error: `API error: ${error.response.status} ${error.response.statusText}`
      };
    }

    if (error.code === 'ECONNABORTED') {
      return {
        valid: false,
        error: 'Request timeout - check your internet connection'
      };
    }

    return {
      valid: false,
      error: `Network error: ${error.message}`
    };
  }
}
