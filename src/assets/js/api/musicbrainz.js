var api = api || {};

api.musicbrainz = (function() {
	var requestQueue = [];
	var isProcessing = false;
	var lastRequestTime = 0;
	var MIN_REQUEST_INTERVAL = 1000; // 1 second minimum between requests
	
	// CORS proxy - set to empty string to disable, or provide a proxy URL
	// Example: "https://cors-anywhere.herokuapp.com/" or your own proxy
	var CORS_PROXY = ""; // Empty = no proxy (will fail due to CORS)
	
	/**
	 * Get country for an artist from MusicBrainz API
	 * @param {String} artist - Artist name
	 * @param {Function} callback - Callback function with result object
	 */
	function getCountry(artist, callback) {
		// Use HTTPS to avoid mixed content issues
		// Include 'inc=area-rels' to get area information with ISO codes
		var url = "https://musicbrainz.org/ws/2/artist/?query=artist:" + encodeURIComponent(artist) + "&fmt=json&limit=1&inc=area-rels";
		
		// Use fetch API instead of XMLHttpRequest
		// Note: User-Agent is a forbidden header in fetch, so we can't set it from browser
		// MusicBrainz requires User-Agent but browsers will ignore it in fetch requests
		try {
			fetch(url, {
				method: 'GET',
				headers: {
					'Accept': 'application/json'
				},
				mode: 'cors' // Explicitly set CORS mode
			})
			.then(function(response) {
				// Check response type - if it's 'opaque' or 'opaqueredirect', CORS failed
				if (response.type === 'opaque' || response.type === 'opaqueredirect') {
					callback({
						artist: artist,
						error: "cors_error"
					});
					return;
				}
				
				if (!response.ok) {
					if (response.status === 503) {
						callback({
							artist: artist,
							error: "rate_limit"
						});
						return;
					}
					callback({
						artist: artist,
						error: "api_error"
					});
					return;
				}
				
				return response.json().catch(function(jsonError) {
					callback({
						artist: artist,
						error: "parse_error"
					});
					throw jsonError; // Re-throw to stop the chain
				});
			})
			.then(function(data) {
				if (!data) {
					// Already handled error case or undefined from catch
					return;
				}
				
				// Parse response
				if (!data || !data.artists || !data.artists.length) {
					callback({
						artist: artist,
						error: "not_found"
					});
					return;
				}
			
			// Get first artist result
			var artistData = data.artists[0];
			
			// Extract country name from area field
			var countryName = null;
			var areaName = null;
			
			// Mapping for common subdivisions to countries
			var subdivisionToCountry = {
				"England": "United Kingdom",
				"Scotland": "United Kingdom",
				"Wales": "United Kingdom",
				"Northern Ireland": "United Kingdom"
			};
			
			// Check if area exists and is a Country type
			if (artistData.area && artistData.area.type === "Country" && artistData.area.name) {
				countryName = artistData.area.name;
				areaName = artistData.area.name;
			}
			// Check if area is a Subdivision that we can map to a country
			else if (artistData.area && artistData.area.type === "Subdivision" && artistData.area.name) {
				countryName = subdivisionToCountry[artistData.area.name];
				areaName = artistData.area.name;
			}
			// Check begin-area if area didn't work
			else if (artistData["begin-area"] && artistData["begin-area"].type === "Country" && artistData["begin-area"].name) {
				countryName = artistData["begin-area"].name;
				areaName = artistData["begin-area"].name;
			}
			// Check if begin-area is a Subdivision that we can map
			else if (artistData["begin-area"] && artistData["begin-area"].type === "Subdivision" && artistData["begin-area"].name) {
				countryName = subdivisionToCountry[artistData["begin-area"].name];
				areaName = artistData["begin-area"].name;
			}
			
			if (countryName) {
				// Return the country name
				callback({
					artist: artist,
					countryName: countryName,
					area: areaName
				});
			} else {
				callback({
					artist: artist,
					error: "no_country"
				});
			}
			})
			.catch(function(error) {
				// Catch any errors in the promise chain
				// Check if it's a CORS/network error
				if (error && error.name === 'TypeError' && (error.message.includes('Failed to fetch') || error.message.includes('NetworkError'))) {
					callback({
						artist: artist,
						error: "cors_error"
					});
				} else {
					callback({
						artist: artist,
						error: "api_error"
					});
				}
			});
		} catch (syncError) {
			// Catch any synchronous errors
			callback({
				artist: artist,
				error: "api_error"
			});
		}
		
		// Return a mock abort function for compatibility
		return {
			abort: function() {
				// Fetch doesn't have a simple abort in older browsers, but we can't easily cancel here
			}
		};
	}
	
	/**
	 * Queue a request with rate limiting
	 * @param {String} artist - Artist name
	 * @param {Function} callback - Callback function
	 */
	function queueRequest(artist, callback) {
		requestQueue.push({
			artist: artist,
			callback: callback
		});
		
		processQueue();
	}
	
	/**
	 * Process the request queue with rate limiting
	 */
	function processQueue() {
		if (isProcessing) {
			return;
		}
		
		if (requestQueue.length === 0) {
			return;
		}
		
		isProcessing = true;
		
		var processNext = function() {
			if (requestQueue.length === 0) {
				isProcessing = false;
				return;
			}
			
			var now = Date.now();
			var timeSinceLastRequest = now - lastRequestTime;
			var delay = Math.max(0, MIN_REQUEST_INTERVAL - timeSinceLastRequest);
			
			setTimeout(function() {
				var request = requestQueue.shift();
				lastRequestTime = Date.now();
				
				getCountry(request.artist, function(result) {
					request.callback(result);
					
					// Process next request
					processNext();
				});
			}, delay);
		};
		
		processNext();
	}
	
	/**
	 * Clear the request queue
	 */
	function clearQueue() {
		requestQueue = [];
		isProcessing = false;
	}
	
	return {
		getCountry: getCountry,
		queueRequest: queueRequest,
		clearQueue: clearQueue
	};
})();

