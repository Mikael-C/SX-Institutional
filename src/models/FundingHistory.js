const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
  const FundingHistory = sequelize.define('FundingHistory', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    positionId: {
      type: DataTypes.UUID,
      allowNull: false
    },
    amount: {
      type: DataTypes.DECIMAL(36, 18),
      allowNull: false
    },
    rate: {
      type: DataTypes.DECIMAL(36, 18),
      allowNull: false
    },
    marginAfter: {
      type: DataTypes.DECIMAL(36, 18),
      allowNull: false
    }
  }, {
    tableName: 'funding_history',
    indexes: [
      { fields: ['positionId'] },
      { fields: ['createdAt'] }
    ]
  });

  return FundingHistory;
};
