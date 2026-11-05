"use strict";
/**
 * FacebookScanTypes.ts
 * TypeScript interfaces cho tất cả scan operations
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SCAN_EXCEL_COLUMNS = exports.SCAN_CONFIGS = void 0;
exports.SCAN_CONFIGS = [
    {
        scanType: 'group_members',
        label: 'Thành viên nhóm',
        icon: '👥',
        description: 'Thu thập tất cả thành viên của một nhóm Facebook',
        requiresUrl: true,
        urlPlaceholder: 'https://facebook.com/groups/...',
        showKeywordInput: false,
        comingSoon: true,
    },
    {
        scanType: 'group_keyword',
        label: 'Nhóm theo từ khóa',
        icon: '🔍',
        description: 'Tìm kiếm và thu thập các nhóm theo từ khóa',
        requiresUrl: false,
        urlPlaceholder: '',
        showKeywordInput: true,
        keywordPlaceholder: 'Nhập từ khóa tìm kiếm nhóm...',
    },
    {
        scanType: 'fanpage_keyword',
        label: 'Fanpage theo từ khóa',
        icon: '🔎',
        description: 'Tìm kiếm và thu thập các fanpage theo từ khóa',
        requiresUrl: false,
        urlPlaceholder: '',
        showKeywordInput: true,
        keywordPlaceholder: 'Nhập từ khóa tìm kiếm fanpage...',
    },
    {
        scanType: 'post_comments',
        label: 'Bình luận bài viết',
        icon: '💬',
        description: 'Thu thập tất cả bình luận của một bài viết',
        requiresUrl: true,
        urlPlaceholder: 'https://facebook.com/.../posts/...',
        showKeywordInput: false,
        comingSoon: true,
    },
    {
        scanType: 'post_keyword',
        label: 'Bài viết theo từ khóa',
        icon: '📝',
        description: 'Tìm kiếm bài viết theo từ khóa',
        requiresUrl: false,
        urlPlaceholder: '',
        showKeywordInput: true,
        keywordPlaceholder: 'Nhập từ khóa tìm kiếm bài viết...',
    },
];
exports.SCAN_EXCEL_COLUMNS = {
    group_members: [
        { key: 'index', label: 'STT', width: 6 },
        { key: 'uid', label: 'ID Facebook', width: 20 },
        { key: 'name', label: 'Tên', width: 30 },
        { key: 'role', label: 'Vai trò', width: 15 },
        { key: 'picture', label: 'Avatar URL', width: 40 },
    ],
    group_keyword: [
        { key: 'index', label: 'STT', width: 6 },
        { key: 'uid', label: 'ID', width: 20 },
        { key: 'name', label: 'Tên nhóm', width: 30 },
        { key: 'type', label: 'Loại', width: 20 },
        { key: 'members', label: 'Số thành viên', width: 20 },
        { key: 'picture', label: 'Ảnh đại diện', width: 40 },
    ],
    fanpage_keyword: [
        { key: 'index', label: 'STT', width: 6 },
        { key: 'uid', label: 'ID', width: 20 },
        { key: 'name', label: 'Tên', width: 30 },
        { key: 'followers', label: 'Số người theo dõi', width: 20 },
        { key: 'picture', label: 'Ảnh đại diện', width: 40 },
    ],
    post_comments: [
        { key: 'index', label: 'STT', width: 6 },
        { key: 'authorName', label: 'Người bình luận', width: 30 },
        { key: 'authorId', label: 'ID', width: 20 },
        { key: 'body', label: 'Nội dung', width: 50 },
        { key: 'timestamp', label: 'Thời gian', width: 20 },
        { key: 'reactions', label: 'Reactions', width: 12 },
    ],
    post_keyword: [
        { key: 'index', label: 'STT', width: 6 },
        { key: 'postId', label: 'ID bài viết', width: 25 },
        { key: 'content', label: 'Nội dung', width: 50 },
        { key: 'timestamp', label: 'Thời gian', width: 20 },
        { key: 'reactions', label: 'Reactions', width: 12 },
        { key: 'comments', label: 'Bình luận', width: 12 },
        { key: 'url', label: 'Link', width: 30 },
    ],
};
//# sourceMappingURL=FacebookScanTypes.js.map