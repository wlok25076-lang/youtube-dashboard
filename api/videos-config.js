// api/videos-config.js
const TRACKED_VIDEOS = {
    'main': {
        id: 'm2ANkjMRuXc',
        name: '純粹とは何か?',
        description: '主要追蹤的YouTube影片',
        color: '#0070f3',
        startDate: '2024-01-01'
    },
    'biryani': {
        id: 'NReeTQ3YTAU',
        name: 'ビリヤニ',
        description: 'ビリヤニに関するYouTube影片',
        color: '#10b981',
        startDate: '2024-01-01'
    },
    'snowghost': {
        id: 'bobUT-j6PeQ',
        name: 'スノウゴースト',
        description: 'スノウゴーストに関するYouTube影片',
        color: '#f59e0b',
        startDate: '2024-01-01'
    }
};

// 獲取所有影片ID
const ALL_VIDEO_IDS = Object.values(TRACKED_VIDEOS).map(v => v.id);

module.exports = {
    TRACKED_VIDEOS,
    ALL_VIDEO_IDS
};