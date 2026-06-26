const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const JailbreakLog = sequelize.define('JailbreakLog', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    ipAddress: {
      type: DataTypes.STRING,
      allowNull: false
    },
    walletAddress: {
      type: DataTypes.STRING,
      allowNull: true
    },
    pattern: {
      type: DataTypes.STRING,
      allowNull: false
    },
    input: {
      type: DataTypes.TEXT,
      allowNull: false
    },
    blocked: {
      type: DataTypes.BOOLEAN,
      defaultValue: true
    },
    lockoutUntil: {
      type: DataTypes.DATE,
      allowNull: true
    }
  }, {
    tableName: 'jailbreak_logs',
    indexes: [
      { fields: ['ipAddress'] },
      { fields: ['walletAddress'] },
      { fields: ['blocked'] },
      { fields: ['createdAt'] }
    ]
  });

  return JailbreakLog;
};
