const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const User = sequelize.define('User', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    walletAddress: {
      type: DataTypes.STRING,
      unique: true,
      allowNull: false,
      validate: {
        notEmpty: true
      }
    },
    sxId: {
      type: DataTypes.STRING,
      unique: true,
      allowNull: false
    },
    username: {
      type: DataTypes.STRING,
      unique: true,
      allowNull: true
    },
    referralCode: {
      type: DataTypes.STRING,
      allowNull: true
    },
    accountTier: {
      type: DataTypes.STRING,
      defaultValue: 'Standard'
    }
  }, {
    tableName: 'users',
    indexes: [
      { unique: true, fields: ['walletAddress'] },
      { unique: true, fields: ['sxId'] },
      { unique: true, fields: ['username'] }
    ]
  });

  return User;
};
