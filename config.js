const Config = {
  url: "https://www.electronjs.org/",
  devtools: true,
  /**
   * If defined, the iframe will expect a message with this
   * string at least every 'reloadAfterSec' seconds. If not, it will reload url.
   */
  ackString: "iframe-content-loaded",
  /**
   * Number of seconds before the iframe reloads if no ackString is received.
   */
  reloadAfterSec: 10,
  username: "hotel-bar",
  deviceId: "digital-signage1",
};

module.exports = Config;
