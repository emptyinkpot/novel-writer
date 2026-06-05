CREATE TABLE IF NOT EXISTS `nw_users` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `email` VARCHAR(191) NOT NULL UNIQUE,
  `password_hash` VARCHAR(255),
  `full_name` VARCHAR(128),
  `avatar_url` TEXT,
  `provider` VARCHAR(32) DEFAULT 'email',
  `user_type` VARCHAR(32) DEFAULT 'free',
  `status` VARCHAR(32) DEFAULT 'active',
  `member_plan` JSON,
  `last_sign_in_at` DATETIME,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS `nw_sessions` (
  `id` INT AUTO_INCREMENT PRIMARY KEY,
  `user_id` INT NOT NULL,
  `title` VARCHAR(255),
  `model` VARCHAR(64) DEFAULT 'gpt-4o',
  `messages` JSON,
  `work_id` INT,
  `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX `idx_nw_sessions_user_id` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
