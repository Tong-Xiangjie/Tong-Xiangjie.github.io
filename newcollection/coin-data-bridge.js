// coin-data-bridge.js
window.COIN_DATA_MAP = {
    commemorativeData: typeof coincommData !== 'undefined' ? coincommData : null,
    circulatingData:   typeof coin_circData !== 'undefined' ? coin_circData : null,
    gold_silverData:   typeof coin_goldData !== 'undefined' ? coin_goldData : null
};
